/**
 * Merchant.txt（交易NPC配置）解析与序列化（纯逻辑，不依赖 vscode，可 Node 单测）
 *
 * 每行一个 NPC，空白分隔，共 15 列（第 8 列「是否沙城NPC」之后可省略，最少 8 列）：
 * 文件名 地图名 坐标X 坐标Y NPC显示名称 NPC标识 形象代码 是否沙城NPC NPC是否可移动
 * NPC移动间隔时间 封号1 封号2 封号3 光源 所处空间
 *
 * 脚本文件为 Envir\Market_def\<文件名>-<地图号>.txt；文件名以「同读」开头（如 同读<功能测试>）
 * 则不需要地图号后缀。
 * `;`/`；` 开头为注释。无法解析的行/注释/空行原样保留，保证 round-trip 不丢内容。
 * 行内单独的 `;` 字段是引擎的空列占位符：显示时视为空，序列化时中间空列写回 `;` 保持列位。
 * 序列化统一为单个空格分隔；行尾空字段丢弃。
 */

export interface MerchantRow {
  /** 原始字段数组，下标对应列；长度可变（第 8 列之后可省略） */
  fields: string[];
}

export type MerchantItem = { type: 'row'; row: MerchantRow } | { type: 'raw'; text: string };
export interface MerchantModel {
  items: MerchantItem[];
}

/** 列定义：label 界面显示，hint 输入提示，group 表单分组 */
export interface MerchantColumn {
  label: string;
  hint?: string;
  group: string;
}

export const MERCHANT_COLUMNS: MerchantColumn[] = [
  { label: '文件名', hint: '同读<名称> 开头的文件名不带地图号后缀', group: '基本' },
  { label: '地图名', hint: '地图号，如 0 或 88003', group: '基本' },
  { label: '坐标X', group: '基本' },
  { label: '坐标Y', group: '基本' },
  { label: 'NPC显示名称', group: '基本' },
  { label: 'NPC标识', group: '外观' },
  { label: '形象代码', group: '外观' },
  { label: '是否沙城NPC', hint: '0/1', group: '行为' },
  { label: 'NPC是否可移动', hint: '一般设 0，设错 NPC 会消失', group: '行为' },
  { label: 'NPC移动间隔时间', group: '行为' },
  { label: '封号1', group: '封号' },
  { label: '封号2', group: '封号' },
  { label: '封号3', group: '封号' },
  { label: '光源', group: '外观' },
  { label: '所处空间', group: '外观' },
];

/** 有效行最少列数：第 8 列「是否沙城NPC」之后可省略 */
export const MERCHANT_MIN_COLUMNS = 8;

export function parseMerchant(text: string): MerchantModel {
  const items: MerchantItem[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('；')) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const fields = trimmed.includes('\t')
      ? trimmed.split('\t').map((s) => s.trim())
      : trimmed.split(/\s+/);
    if (fields.length >= MERCHANT_MIN_COLUMNS) {
      items.push({ type: 'row', row: { fields } });
    } else {
      items.push({ type: 'raw', text: line });
    }
  }
  return { items };
}

/** 检测是否需要对齐整理：数据行中含 Tab 或连续多个空格 */
export function merchantNeedsAlignment(text: string): boolean {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('；')) continue;
    if (trimmed.includes('\t') || /\s{2,}/.test(trimmed)) return true;
  }
  return false;
}

/** 字段是否为空：空串或引擎的空列占位符 `;` */
export function isEmptyField(v: string): boolean {
  return v === '' || v === ';';
}

export function serializeMerchant(model: MerchantModel): string {
  const lines: string[] = [];
  for (const item of model.items) {
    if (item.type === 'raw') {
      lines.push(item.text);
      continue;
    }
    const fs = item.row.fields.map((f) => f.trim());
    let last = fs.length - 1;
    while (last >= 0 && isEmptyField(fs[last])) last--;
    // 中间空列写回 ; 占位，保持后续列位不偏移；行尾空列丢弃
    const out = fs.slice(0, last + 1).map((f) => (f === '' ? ';' : f));
    lines.push(out.join(' '));
  }
  return lines.join('\r\n').replace(/\r\n$/, '') + '\r\n';
}

export function merchantRows(model: MerchantModel): MerchantRow[] {
  return model.items.filter((i) => i.type === 'row').map((i) => (i as { type: 'row'; row: MerchantRow }).row);
}

export function rowField(row: MerchantRow, index: number): string {
  return row.fields[index] ?? '';
}

export function setRowField(row: MerchantRow, index: number, value: string): void {
  while (row.fields.length < index) row.fields.push('');
  row.fields[index] = value;
}

/**
 * NPC 脚本相对 Market_def 的路径(不含扩展名):
 * 文件名以「同读」开头时不带地图号后缀, 否则为 <文件名>-<地图号>
 */
export function merchantScriptRel(name: string, mapId: string): string {
  return name.startsWith('同读') ? name : `${name}-${mapId}`;
}

/**
 * 脚本相对 Market_def 的候选路径(不含扩展名, 用 \ 分隔), 按优先级排序。
 * 「同读」写法在磁盘上有多种实际布局(同读<目录\文件> / 目录\同读<文件> / 目录\文件), 全部覆盖:
 *   同读<传送门/机关传送门> -> [同读<传送门\机关传送门>, 传送门\同读<机关传送门>, 传送门\机关传送门]
 */
export function merchantScriptCandidates(name: string, mapId: string): string[] {
  const out: string[] = [];
  const push = (s: string) => { if (s && !out.includes(s)) out.push(s); };
  push(merchantScriptRel(name.replace(/\//g, '\\'), mapId));
  const m = name.match(/^同读<(.+?)>$/);
  if (m) {
    const parts = m[1].split(/[\\/]/).filter(Boolean);
    const file = parts[parts.length - 1] || m[1];
    const dir = parts.slice(0, -1).join('\\');
    push((dir ? dir + '\\' : '') + `同读<${file}>`);
    push((dir ? dir + '\\' : '') + file);
  }
  return out;
}
