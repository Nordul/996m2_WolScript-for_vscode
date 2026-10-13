/**
 * MapInfo.txt / MiniMap.txt 解析与序列化（纯逻辑，不依赖 vscode，可 Node 单测）
 *
 * MapInfo.txt 行格式：
 *   [地图号 名称] 参数 参数(值) ...
 *   [<源图号>新图号 名称] ...   映射方式一：沿用原图小地图
 *   [源图号|新图号 名称] ...    映射方式二：独立地图
 * `;` 开头为注释。无法解析的行/注释/空行原样保留，保证 round-trip 不丢内容。
 */

export interface MapParamValue {
  /** 参数名（统一大写存储） */
  name: string;
  /** 括号内的参数文本，无括号参数为 undefined */
  arg?: string;
}

export type MapKind = 'normal' | 'mirrorReuse' | 'mirrorIndependent';

export interface MapEntry {
  kind: MapKind;
  /** 新地图号（normal 时即地图号本身） */
  id: string;
  name: string;
  /** 镜像地图的源地图号 */
  srcId?: string;
  params: MapParamValue[];
}

/** 文件模型：items 保序，entry 为解析出的地图，raw 为原样保留的行 */
export type MapInfoItem = { type: 'entry'; entry: MapEntry } | { type: 'raw'; text: string };
export interface MapInfoModel {
  items: MapInfoItem[];
}

export interface MiniMapRow {
  mapId: string;
  miniMapId: string;
}
export type MiniMapItem = { type: 'row'; row: MiniMapRow } | { type: 'raw'; text: string };
export interface MiniMapModel {
  items: MiniMapItem[];
}

/** 头部：[<src>id name] 或 [src|id name] 或 [id name]，名称可含空格则取首个空白分隔 */
const HEADER_RE = /^\s*\[\s*(?:<([^>\]]+)>\s*)?([^\s\]|<]+?)(?:\s*\|\s*([^\s\]]+))?\s+([^\]]*?)\s*\]\s*(.*)$/;

/** 拆分参数段：按空白分隔，但括号内（含空格的情况）不拆 */
function splitParams(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '（') depth++;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function parseParam(token: string): MapParamValue {
  const m = /^([^(（]+)[(（](.*)[)）]$/.exec(token);
  if (m) return { name: m[1].toUpperCase(), arg: m[2] };
  return { name: token.toUpperCase() };
}

export function parseMapInfo(text: string): MapInfoModel {
  const items: MapInfoItem[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const m = HEADER_RE.exec(line);
    if (!m) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const [, reuseSrc, a, b, name, rest] = m;
    let entry: MapEntry;
    if (reuseSrc !== undefined) {
      // [<src>id name]：沿用原图小地图。a 此时为新图号
      entry = { kind: 'mirrorReuse', id: a, srcId: reuseSrc, name, params: [] };
    } else if (b !== undefined) {
      // [src|id name]：独立地图
      entry = { kind: 'mirrorIndependent', id: b, srcId: a, name, params: [] };
    } else {
      entry = { kind: 'normal', id: a, name, params: [] };
    }
    entry.params = splitParams(rest).filter((t) => t.length > 0).map(parseParam);
    items.push({ type: 'entry', entry });
  }
  return { items };
}

function serializeParam(p: MapParamValue): string {
  return p.arg !== undefined && p.arg !== '' ? `${p.name}(${p.arg})` : p.name;
}

export function serializeMapInfo(model: MapInfoModel): string {
  const lines: string[] = [];
  for (const item of model.items) {
    if (item.type === 'raw') {
      lines.push(item.text);
      continue;
    }
    const e = item.entry;
    let head: string;
    if (e.kind === 'mirrorReuse') head = `[<${e.srcId}>${e.id} ${e.name}]`;
    else if (e.kind === 'mirrorIndependent') head = `[${e.srcId}|${e.id} ${e.name}]`;
    else head = `[${e.id} ${e.name}]`;
    const params = e.params.map(serializeParam);
    lines.push(params.length ? `${head} ${params.join(' ')}` : head);
  }
  // 保持文件末尾换行
  return lines.join('\r\n').replace(/\r\n$/, '') + '\r\n';
}

export function parseMiniMap(text: string): MiniMapModel {
  const items: MiniMapItem[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) {
      items.push({ type: 'raw', text: line });
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      items.push({ type: 'row', row: { mapId: parts[0], miniMapId: parts[1] } });
    } else {
      items.push({ type: 'raw', text: line });
    }
  }
  return { items };
}

export function serializeMiniMap(model: MiniMapModel): string {
  const lines: string[] = [];
  for (const item of model.items) {
    if (item.type === 'raw') lines.push(item.text);
    else lines.push(`${item.row.mapId}\t${item.row.miniMapId}`);
  }
  return lines.join('\r\n').replace(/\r\n$/, '') + '\r\n';
}

export function mapInfoEntries(model: MapInfoModel): MapEntry[] {
  return model.items.filter((i) => i.type === 'entry').map((i) => (i as { type: 'entry'; entry: MapEntry }).entry);
}

export function miniMapRows(model: MiniMapModel): MiniMapRow[] {
  return model.items.filter((i) => i.type === 'row').map((i) => (i as { type: 'row'; row: MiniMapRow }).row);
}
