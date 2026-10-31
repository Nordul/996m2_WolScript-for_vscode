import * as iconv from 'iconv-lite';

/** sql.js Database 的最小查询接口 (与 node 测试环境解耦, 便于 Node 直测) */
export interface SqlLikeDb {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlLikeStmt;
}

export interface SqlLikeStmt {
  bind(params?: any): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

export type NameKind = 'item' | 'monster' | 'skill';

/** 名称来源表: 物品 / 怪物 / 技能 (对应 StdItems/Monster/Magic 的名称列) */
const NAME_SOURCES: Record<NameKind, { table: string; column: string }> = {
  item: { table: 'StdItems', column: 'Name' },
  monster: { table: 'Monster', column: 'Name' },
  skill: { table: 'Magic', column: 'MagName' },
};

/** 表列信息 (声明类型 CHAR/CLOB/TEXT 的列按文本处理, 需 GBK 解码) */
interface ColumnInfo {
  name: string;
  text: boolean;
}

/** 每个 db 实例缓存表结构, 避免重复 PRAGMA */
const tableInfoCache = new WeakMap<SqlLikeDb, Map<string, ColumnInfo[]>>();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 取标量值 (COUNT 等) */
function scalar(db: SqlLikeDb, sql: string): number {
  const res = db.exec(sql);
  const v = res[0] && res[0].values[0] && res[0].values[0][0];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

/** 字符串 -> GBK 字节 hex 字面量, 供 instr() 做字节级子串匹配 */
export function gbkBlobHex(s: string): string {
  return `X'${iconv.encode(s, 'gbk').toString('hex').toUpperCase()}'`;
}

function getColumnsInfo(db: SqlLikeDb, table: string): ColumnInfo[] {
  let cache = tableInfoCache.get(db);
  if (!cache) {
    cache = new Map();
    tableInfoCache.set(db, cache);
  }
  const hit = cache.get(table);
  if (hit) return hit;
  const res = db.exec(`PRAGMA table_info(${quoteIdent(table)})`);
  const cols: ColumnInfo[] = [];
  if (res[0]) {
    const idxName = res[0].columns.indexOf('name');
    const idxType = res[0].columns.indexOf('type');
    for (const row of res[0].values) {
      const type = String(row[idxType] ?? '');
      cols.push({ name: String(row[idxName]), text: /CHAR|CLOB|TEXT/i.test(type) });
    }
  }
  cache.set(table, cols);
  return cols;
}

/** 所有数据表及行数 */
export function listTables(db: SqlLikeDb): { name: string; count: number }[] {
  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  if (!res[0]) return [];
  return res[0].values.map((row) => {
    const name = String(row[0]);
    return { name, count: scalar(db, `SELECT COUNT(*) FROM ${quoteIdent(name)}`) };
  });
}

/** 表的列名 (按定义顺序) */
export function getColumns(db: SqlLikeDb, table: string): string[] {
  return getColumnsInfo(db, table).map((c) => c.name);
}

export interface PagedRows {
  rows: Record<string, unknown>[];
  total: number;
  columns: string[];
}

/** 分页读取表数据; filter 对所有文本列做 GBK 字节级子串匹配 (instr) */
export function getRows(
  db: SqlLikeDb,
  table: string,
  offset: number,
  limit: number,
  filter?: string,
): PagedRows {
  const cols = getColumnsInfo(db, table);
  const textCols = cols.filter((c) => c.text);
  let where = '';
  if (filter && filter.trim()) {
    // LIKE 对非 UTF-8 字节按 UTF-8 码点贪婪读取, 会误匹配 GBK 文本; instr 才是字节级子串
    const needle = gbkBlobHex(filter.trim());
    const conds = textCols.map((c) => `instr(CAST(${quoteIdent(c.name)} AS BLOB), ${needle}) > 0`).join(' OR ');
    if (conds) where = ` WHERE ${conds}`;
  }
  const total = scalar(db, `SELECT COUNT(*) FROM ${quoteIdent(table)}${where}`);
  // 文本列以 BLOB 取出原始字节, JS 侧按 GBK 解码 (库内文本实为 GBK, 头却声明 UTF-8)
  const selectList = cols
    .map((c) => (c.text ? `CAST(${quoteIdent(c.name)} AS BLOB) AS ${quoteIdent(c.name)}` : quoteIdent(c.name)))
    .join(', ');
  const rows: Record<string, unknown>[] = [];
  const stmt = db.prepare(`SELECT ${selectList} FROM ${quoteIdent(table)}${where} LIMIT ? OFFSET ?`);
  try {
    stmt.bind([limit, offset]);
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      for (const c of textCols) {
        const v = obj[c.name];
        if (v instanceof Uint8Array) obj[c.name] = iconv.decode(Buffer.from(v), 'gbk');
      }
      rows.push(obj);
    }
  } finally {
    stmt.free();
  }
  return { rows, total, columns: cols.map((c) => c.name) };
}

/** 取物品/怪物/技能名称列表 (GBK 解码、去空白、去重、去空) */
export function getNames(db: SqlLikeDb, kind: NameKind): string[] {
  const { table, column } = NAME_SOURCES[kind];
  const res = db.exec(`SELECT CAST(${quoteIdent(column)} AS BLOB) FROM ${quoteIdent(table)}`);
  const seen = new Set<string>();
  const names: string[] = [];
  if (res[0]) {
    for (const row of res[0].values) {
      const v = row[0];
      if (!(v instanceof Uint8Array)) continue;
      const name = iconv.decode(Buffer.from(v), 'gbk').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}
