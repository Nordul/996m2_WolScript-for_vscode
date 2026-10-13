/**
 * MonItems 爆率文件解析与模拟（纯逻辑，不依赖 vscode，可 Node 单测）
 *
 * 行格式（文档 726 页）：
 *   分子/分母 [*]物品1[,权重]|物品2[,权重]... [数量] [H/G 条件...] [@触发脚本]
 * - `*` 前缀（组级或物品级）：不受爆率翻倍命令影响
 * - `|` 多物品组：命中行概率后从中掉一件，按 `,权重` 加权，无权重则均分
 * - `#CALL [\路径\文件.txt] @标签` 行：嵌套调用，仅展示不参与模拟
 * - `;` 开头为注释，无法解析的行原样保留
 */

export interface DropItem {
  name: string;
  weight?: number;
  noBoost: boolean;
}

export interface DropLine {
  num: number;
  den: number;
  items: DropItem[];
  /** 行概率 num/den（0-1），分母非法时为 0 */
  p: number;
  /** 行尾附加内容（数量/条件/触发脚本等），原样保留用于展示 */
  extras: string;
}

export type DropFileItem =
  | { type: 'drop'; line: DropLine }
  | { type: 'call'; text: string }
  | { type: 'raw'; text: string };

export interface DropFileModel {
  items: DropFileItem[];
}

const DROP_RE = /^\s*(\d+)\s*\/\s*(\d+)\s+(\S+)(.*)$/;
const CALL_RE = /^\s*#CALL\b/i;

function parseItemGroup(token: string): DropItem[] {
  return token.split('|').map((part) => {
    let s = part.trim();
    let noBoost = false;
    if (s.startsWith('*')) { noBoost = true; s = s.slice(1); }
    let weight: number | undefined;
    const comma = s.lastIndexOf(',');
    if (comma >= 0) {
      const w = Number(s.slice(comma + 1));
      if (!isNaN(w) && s.slice(comma + 1).trim() !== '') {
        weight = w;
        s = s.slice(0, comma);
      }
    }
    return { name: s.trim(), weight, noBoost };
  }).filter((it) => it.name !== '');
}

export function parseDropFile(text: string): DropFileModel {
  const items: DropFileItem[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('；')) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    if (CALL_RE.test(line)) {
      items.push({ type: 'call', text: trimmed });
      continue;
    }
    const m = DROP_RE.exec(line);
    if (!m) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const num = parseInt(m[1], 10);
    const den = parseInt(m[2], 10);
    const groupNoBoost = m[3].startsWith('*');
    const dropItems = parseItemGroup(m[3]);
    if (groupNoBoost) for (const it of dropItems) it.noBoost = true;
    // 行尾注释（; 或 ；开头）从附加内容中去掉，仅影响展示
    let extras = m[4].trim();
    const commentIdx = extras.search(/[;；]/);
    if (commentIdx >= 0) extras = extras.slice(0, commentIdx).trim();
    items.push({
      type: 'drop',
      line: {
        num, den,
        items: dropItems,
        p: den > 0 ? num / den : 0,
        extras,
      },
    });
  }
  return { items };
}

/** 每个物品的单次掉落概率：行概率 × 组内权重占比（无权重均分） */
export function itemChances(line: DropLine): { item: DropItem; p: number }[] {
  const totalWeight = line.items.reduce((s, it) => s + (it.weight ?? 1), 0);
  return line.items.map((item) => ({
    item,
    p: totalWeight > 0 ? line.p * ((item.weight ?? 1) / totalWeight) : 0,
  }));
}

export function serializeDropFile(model: DropFileModel): string {
  const lines: string[] = [];
  for (const item of model.items) {
    if (item.type === 'raw') {
      lines.push(item.text);
      continue;
    }
    if (item.type === 'call') {
      lines.push(item.text);
      continue;
    }
    const l = item.line;
    const token = l.items
      .map((it) => (it.noBoost ? '*' : '') + it.name + (it.weight !== undefined ? `,${it.weight}` : ''))
      .join('|');
    lines.push(`${l.num}/${l.den} ${token}${l.extras ? ' ' + l.extras : ''}`);
  }
  return lines.join('\r\n').replace(/\r\n$/, '') + '\r\n';
}

/** 行尾附加内容中是否含 H/G 条件检测（如 `1 H $LEVEL > 50`） */
export function hasCondition(extras: string): boolean {
  return /\b[HG]\s+\$/.test(extras);
}

/** 行是否受爆率翻倍影响：整组物品都带 * 才不受翻倍 */
export function isBoostable(line: DropLine): boolean {
  return line.items.some((it) => !it.noBoost);
}

/** 应用翻倍倍数后的行概率（mult 为引擎倍率写法，200 = 2 倍） */
export function boostedP(line: DropLine, mult: number): number {
  const p = isBoostable(line) ? line.p * (mult / 100) : line.p;
  return Math.min(1, p);
}

export interface SimOptions {
  /** 爆率翻倍倍率（100 = 不翻倍，200 = 2 倍） */
  mult?: number;
  /** 含 H/G 条件的行是否视为条件成立（默认 true） */
  conditionsPass?: boolean;
}

export interface SimResult {
  rounds: number;
  /** 每轮掉落的物品名列表（无掉落为空数组） */
  perRound: string[][];
  /** 物品名 -> 总次数 */
  totals: Record<string, number>;
}

/** 可注入随机数源便于测试。rand() 返回 [0,1) */
export function simulateDrops(
  lines: DropLine[], rounds: number, rand: () => number = Math.random, opts: SimOptions = {},
): SimResult {
  const mult = opts.mult ?? 100;
  const conditionsPass = opts.conditionsPass ?? true;
  const active = lines
    .filter((l) => conditionsPass || !hasCondition(l.extras))
    .map((l) => ({ line: l, p: boostedP(l, mult) }));
  const perRound: string[][] = [];
  const totals: Record<string, number> = {};
  for (let r = 0; r < rounds; r++) {
    const got: string[] = [];
    for (const { line, p } of active) {
      if (p <= 0 || line.items.length === 0) continue;
      if (rand() >= p) continue;
      const totalWeight = line.items.reduce((s, it) => s + (it.weight ?? 1), 0);
      let pick = rand() * totalWeight;
      let chosen = line.items[line.items.length - 1];
      for (const it of line.items) {
        pick -= it.weight ?? 1;
        if (pick < 0) { chosen = it; break; }
      }
      got.push(chosen.name);
      totals[chosen.name] = (totals[chosen.name] ?? 0) + 1;
    }
    perRound.push(got);
  }
  return { rounds, perRound, totals };
}

/** 测试用确定性随机源（LCG） */
export function seededRand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
