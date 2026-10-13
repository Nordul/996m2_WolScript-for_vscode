/**
 * MonGen.txt（刷怪配置）解析与序列化（纯逻辑，不依赖 vscode，可 Node 单测）
 *
 * 每行一条刷怪记录，空白分隔，共 23 列（旧格式可能更少，按实际列数保留）：
 * 地图 X Y 怪物名 范围 数量 间隔(分) 集中刷新0-100 死了才刷 重命名 等级 封号1 封号2 封号3
 * 刷新触发标签 是否走动 墓碑类型 墓碑素材 小地图图标 tips标识 墓碑文字显示 小地图文字显示 墓碑刷新方式
 *
 * `;`/`；` 开头为注释。无法解析的行/注释/空行原样保留，保证 round-trip 不丢内容。
 * 行内单独的 `;` 字段是引擎的空列占位符：显示时视为空，序列化时中间空列写回 `;` 保持列位。
 * 序列化统一为单个空格分隔；行尾空字段丢弃。
 */

export interface MonGenRow {
  /** 原始字段数组，下标对应列；长度可变（兼容旧格式） */
  fields: string[];
}

export type MonGenItem = { type: 'row'; row: MonGenRow } | { type: 'raw'; text: string };
export interface MonGenModel {
  items: MonGenItem[];
}

/** 列定义：label 界面显示，hint 输入提示，group 表单分组 */
export interface MonGenColumn {
  label: string;
  hint?: string;
  group: string;
}

export const MON_GEN_COLUMNS: MonGenColumn[] = [
  { label: '地图', hint: '地图号，如 0 或 *L006', group: '基本' },
  { label: '坐标X', group: '基本' },
  { label: '坐标Y', group: '基本' },
  { label: '怪物名字', group: '基本' },
  { label: '范围', group: '刷新' },
  { label: '数量', group: '刷新' },
  { label: '间隔(分钟)', group: '刷新' },
  { label: '集中刷新机率', hint: '0-100', group: '刷新' },
  { label: '死了才刷', hint: '0/1', group: '刷新' },
  { label: '重命名', hint: '新名字，不需要可留空', group: '怪物' },
  { label: '怪物等级', group: '怪物' },
  { label: '封号1', group: '怪物' },
  { label: '封号2', group: '怪物' },
  { label: '封号3', group: '怪物' },
  { label: '刷新触发标签', hint: '@标签（触发机器人）', group: '刷新' },
  { label: '是否走动', hint: '0/1', group: '刷新' },
  { label: '墓碑类型', hint: '0=无 1=调用图片', group: '墓碑' },
  { label: '墓碑素材', hint: '素材编号', group: '墓碑' },
  { label: '小地图图标', hint: '素材编号', group: '小地图' },
  { label: 'tips标识', group: '小地图' },
  { label: '墓碑文字显示', hint: '0=名字+倒计时 1=不显示 2=只名字 3=只倒计时', group: '墓碑' },
  { label: '小地图文字显示', hint: '0=名字+倒计时 1=不显示 2=只名字 3=只倒计时', group: '小地图' },
  { label: '墓碑刷新方式', hint: '0=原地 1=定点普通刷 2=预算下个点', group: '墓碑' },
];

/** 快捷编辑（列表下方直接展示）的列下标 */
export const MON_GEN_QUICK_COLS = [0, 1, 2, 4, 5, 6];

const MIN_COLUMNS = 7;

export function parseMonGen(text: string): MonGenModel {
  const items: MonGenItem[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('；')) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const fields = trimmed.includes('\t')
      ? trimmed.split('\t').map((s) => s.trim())
      : trimmed.split(/\s+/);
    if (fields.length >= MIN_COLUMNS) {
      items.push({ type: 'row', row: { fields } });
    } else {
      items.push({ type: 'raw', text: line });
    }
  }
  return { items };
}

/** 检测是否需要对齐整理：数据行中含 Tab 或连续多个空格 */
export function monGenNeedsAlignment(text: string): boolean {
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

export function serializeMonGen(model: MonGenModel): string {
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

export function monGenRows(model: MonGenModel): MonGenRow[] {
  return model.items.filter((i) => i.type === 'row').map((i) => (i as { type: 'row'; row: MonGenRow }).row);
}

export function rowField(row: MonGenRow, index: number): string {
  return row.fields[index] ?? '';
}

/** 地图字段（第 0 列）前缀 `*` 表示智能刷怪，返回真实地图号与智能标记 */
export function parseMapField(v: string): { id: string; smart: boolean } {
  return v.startsWith('*') ? { id: v.slice(1), smart: true } : { id: v, smart: false };
}

export function buildMapField(id: string, smart: boolean): string {
  return smart ? `*${id}` : id;
}

export function setRowField(row: MonGenRow, index: number, value: string): void {
  while (row.fields.length < index) row.fields.push('');
  row.fields[index] = value;
}
