/* GameLoad.DB 数据访问层测试: node scripts/dbtest.js
 * 用 sql.js 加载 example/DB/GameLoad.DB, 测试 out/db/dbQueries.js 的纯查询函数 */
const path = require('path');
const initSqlJs = require('sql.js');
const q = require('../out/db/dbQueries');

const DB_PATH = path.join(__dirname, '..', 'example', 'DB', 'GameLoad.DB');

let fail = 0;
function assert(cond, name, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ': ' + extra : ''}`);
  if (!cond) fail++;
}

(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });
  const fs = require('fs');
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  // listTables: 含核心表且行数正确
  const tables = q.listTables(db);
  const byName = new Map(tables.map((t) => [t.name, t.count]));
  assert(byName.has('StdItems') && byName.has('Monster') && byName.has('Magic'), 'listTables 含 StdItems/Monster/Magic');
  assert(byName.get('StdItems') === 2085 && byName.get('Monster') === 1138 && byName.get('Magic') === 68,
    'listTables 行数', `StdItems=${byName.get('StdItems')} Monster=${byName.get('Monster')} Magic=${byName.get('Magic')}`);

  // getNames: 物品/怪物/技能名 GBK 解码正确
  const items = q.getNames(db, 'item');
  const monsters = q.getNames(db, 'monster');
  const skills = q.getNames(db, 'skill');
  assert(items.includes('金币'), "getNames('item') 含 金币", `共 ${items.length} 个`);
  assert(monsters.includes('铜人'), "getNames('monster') 含 铜人", `共 ${monsters.length} 个`);
  assert(skills.includes('刺杀剑术'), "getNames('skill') 含 刺杀剑术", `共 ${skills.length} 个`);
  assert(items.length > 0 && items.every((n) => n === n.trim() && n.length > 0), 'getNames 去空白去空');
  assert(new Set(items).size === items.length, 'getNames 去重');

  // getColumns: 列名含名称列
  const cols = q.getColumns(db, 'StdItems');
  assert(Array.isArray(cols) && cols.includes('Name') && cols.includes('Idx'), 'getColumns(StdItems)');

  // getRows 分页: 10 行且 Name 为可读中文 (无乱码 U+FFFD)
  const p1 = q.getRows(db, 'StdItems', 0, 10);
  assert(p1.rows.length === 10, 'getRows(StdItems,0,10) 返回 10 行', `实际 ${p1.rows.length}`);
  assert(p1.total === 2085 && p1.columns.includes('Name'), 'getRows total/columns');
  const names = p1.rows.map((r) => String(r.Name));
  assert(names.every((n) => !n.includes('�')), 'getRows Name 无乱码', names.slice(0, 3).join(','));
  assert(names.some((n) => /[一-龥]/.test(n)), 'getRows Name 含中文');

  // 第二页与第一页不重叠
  const p2 = q.getRows(db, 'StdItems', 10, 10);
  assert(p2.rows.length === 10 && String(p2.rows[0].Idx) !== String(p1.rows[0].Idx), 'getRows 第二页偏移正确');

  // filter: 对文本列 GBK 字节级子串匹配 (铜人 -> Monster 5 行)
  const mf = q.getRows(db, 'Monster', 0, 200, '铜人');
  assert(mf.total === 5 && mf.rows.every((r) => String(r.Name).includes('铜人')), 'getRows 过滤 铜人 total=5', `实际 ${mf.total}`);

  // filter: 物品过滤 (金币 -> 4 行, 均真实包含子串)
  const sf = q.getRows(db, 'StdItems', 0, 200, '金币');
  assert(sf.total === 4 && sf.rows.every((r) => String(r.Name).includes('金币')), 'getRows 过滤 金币', `total=${sf.total}`);
  assert(sf.rows.some((r) => String(r.Name) === '金币'), 'getRows 过滤含精确项 金币');

  // filter: 通配符按字面量处理 (instr 无语义), 含 % 输入不炸且不误匹配全部
  const esc = q.getRows(db, 'StdItems', 0, 10, '100%');
  assert(esc.total === 0, 'getRows 过滤含 % 按字面匹配 total=0', `实际 ${esc.total}`);

  db.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  process.exit(1);
});
