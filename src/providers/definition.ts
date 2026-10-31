import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IGNORE_GLOB, decodeScript, hasHiddenSegment, isEngineScriptPath } from '../scanner/scanCore';
import { findLabelReferences } from './references';

// 命令参数中的脚本/数据文件路径: ..\QuestDiary\数据文件\权限账号.txt / QuestDiary\xxx.txt 等
const PATH_TOKEN_RE = /[^\s;[\]<>|()]*[\\/][^\s;[\]<>|()]*?\.(?:txt|csv)\b/gi;

// #CALL [\子目录\文件.txt] @标签
const CALL_RE = /^\s*#CALL\s+\[([^\]]+)\](?:\s+@([^\s;]+))?/i;
// <$cfg_文件名称(1_7)> -> QuestDiary/cfg_文件名称.csv 第1行第7列(0基)
// 行列支持变量表达式, 如 <$cfg_guanzhi(1_<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>)>
const CFG_HEAD_RE = /<\$cfg_([A-Za-z0-9_一-鿿]+)\(/gi;

export function parseCfgRef(line: string): { name: string; row?: number; col?: number; start: number; end: number }[] {
  const out: { name: string; row?: number; col?: number; start: number; end: number }[] = [];
  for (const m of line.matchAll(CFG_HEAD_RE)) {
    const start = m.index!;
    const innerStart = start + m[0].length;
    // 平衡扫描: 嵌套的 <$ 加深, > 减浅, 找到真正闭合外层的那一对
    let depth = 1, i = innerStart, end = -1;
    while (i < line.length) {
      if (line.startsWith('<$', i)) { depth++; i += 2; continue; }
      if (line[i] === '>') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
        i++;
        continue;
      }
      i++;
    }
    if (end < 0) { out.push({ name: m[1], start, end: innerStart }); continue; }
    let inner = line.slice(innerStart, end - 1);
    if (inner.endsWith(')')) inner = inner.slice(0, -1);
    const usIdx = inner.indexOf('_');
    const rowExpr = usIdx >= 0 ? inner.slice(0, usIdx) : inner;
    const colExpr = usIdx >= 0 ? inner.slice(usIdx + 1) : '';
    // 行列都是纯数字才精确定位; 任一方含变量则只打开文件
    if (/^\d+$/.test(rowExpr) && /^\d+$/.test(colExpr)) {
      out.push({ name: m[1], row: parseInt(rowExpr, 10), col: parseInt(colExpr, 10), start, end });
    } else {
      out.push({ name: m[1], start, end });
    }
  }
  return out;
}

/** csv 某行第 col 列(0基, 逗号分隔)的起始字符偏移 */
export function csvFieldOffset(lineText: string, col: number): number {
  let pos = 0;
  for (let c = 0; c < col; c++) {
    const idx = lineText.indexOf(',', pos);
    if (idx < 0) return lineText.length;
    pos = idx + 1;
  }
  return pos;
}

export function parseCallLine(line: string): { file: string; label?: string; fileStart: number; fileEnd: number; labelStart: number; labelEnd: number } | undefined {
  const m = line.match(CALL_RE);
  if (!m) return undefined;
  const lb = line.indexOf('[');
  const rb = line.indexOf(']', lb);
  let labelStart = -1, labelEnd = -1;
  if (m[2]) {
    labelStart = line.indexOf('@' + m[2], rb);
    labelEnd = labelStart + m[2].length + 1;
  }
  return { file: m[1], label: m[2], fileStart: lb, fileEnd: rb + 1, labelStart, labelEnd };
}

/** 向上查找当前文件祖先目录中的 QuestDiary 根目录 */
function ancestorQuestDiary(fsPath: string): string | undefined {
  let dir = path.dirname(fsPath);
  while (true) {
    if (path.basename(dir).toLowerCase() === 'questdiary') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function findQuestDiaryRoot(docPath: string): Promise<string | undefined> {
  const fromDoc = ancestorQuestDiary(docPath);
  if (fromDoc) return fromDoc;
  // 当前文件不在 QuestDiary 内(如 Funtion_def/Market_def 等同级目录):
  // 沿祖先目录找包含 QuestDiary 子目录的那一级(引擎 Envir 根)
  let dir = path.dirname(docPath);
  while (true) {
    const cand = path.join(dir, 'QuestDiary');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底: 工作区内任意 QuestDiary 目录下的文件反推根目录 (含多级子目录)
  const any = await vscode.workspace.findFiles('**/QuestDiary/**/*.txt', IGNORE_GLOB, 1);
  if (any.length) return ancestorQuestDiary(any[0].fsPath);
  return undefined;
}

function labelPositionInLines(lines: string[], label: string): vscode.Position | undefined {
  const re = new RegExp(`^\\s*\\[@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return new vscode.Position(i, m[0].indexOf('['));
  }
  return undefined;
}

function labelPosition(doc: vscode.TextDocument, label: string): vscode.Position | undefined {
  return labelPositionInLines(Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text), label);
}

async function crossFileLabelDefinitions(document: vscode.TextDocument, label: string): Promise<vscode.Location[]> {
  let files: vscode.Uri[];
  try {
    files = await vscode.workspace.findFiles('**/*.txt', IGNORE_GLOB, 5000);
  } catch {
    return [];
  }

  const pathKey = (fsPath: string) => path.normalize(fsPath).toLowerCase();
  const currentPath = pathKey(document.uri.fsPath);
  const openDocs = new Map<string, vscode.TextDocument>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') openDocs.set(pathKey(doc.uri.fsPath), doc);
  }

  const locations: vscode.Location[] = [];
  for (const uri of files) {
    const key = pathKey(uri.fsPath);
    if (key === currentPath || !isEngineScriptPath(uri.fsPath) || hasHiddenSegment(uri.fsPath)) continue;
    try {
      const openDoc = openDocs.get(key);
      const pos = openDoc
        ? labelPosition(openDoc, label)
        : labelPositionInLines(decodeScript(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/), label);
      if (pos) locations.push(new vscode.Location(uri, pos));
    } catch {
      // 单个文件读取失败不影响其它候选
    }
  }
  return locations;
}

/**
 * 解析命令参数中的文件路径为磁盘绝对路径
 * 依次尝试: 当前文件目录 / 工作区根 / 引擎根(QuestDiary父目录), 原始与去掉前导 ..\ 两种形态
 */
export function resolveScriptPath(docPath: string, raw: string): string | undefined {
  const rel = raw.replace(/^(?:\.{1,2}[\\/])+/, '');
  const bases: string[] = [path.dirname(docPath)];
  for (const f of vscode.workspace.workspaceFolders || []) bases.push(f.uri.fsPath);
  const qd = ancestorQuestDiary(docPath);
  if (qd) bases.push(path.dirname(qd), qd);
  for (const base of bases) {
    for (const cand of [path.resolve(base, raw), path.resolve(base, rel)]) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  return undefined;
}

export class M2DefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | vscode.Location[] | undefined> {
    const line = document.lineAt(position.line).text;

    // 1. #CALL [文件] @标签 -> 跨文件跳转
    const call = parseCallLine(line);
    if (call) {
      const onFile = position.character >= call.fileStart && position.character <= call.fileEnd;
      const onLabel = call.labelStart >= 0 && position.character >= call.labelStart && position.character <= call.labelEnd;
      if (!onFile && !onLabel) return undefined;
      const root = await findQuestDiaryRoot(document.uri.fsPath);
      if (!root) return undefined;
      const rel = call.file.replace(/^[/\\]+/, '').split(/[/\\]+/).join(path.sep);
      const target = path.join(root, rel);
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      } catch {
        return undefined;
      }
      const pos = call.label ? labelPosition(doc, call.label) : undefined;
      return new vscode.Location(doc.uri, pos ?? new vscode.Position(0, 0));
    }

    // 1.5 <$cfg_名称(行_列)> -> 跳转到 QuestDiary/cfg_名称.csv 对应单元格
    for (const ref of parseCfgRef(line)) {
      if (position.character < ref.start || position.character > ref.end) continue;
      const root = await findQuestDiaryRoot(document.uri.fsPath);
      if (!root) return undefined;
      const target = path.join(root, `cfg_${ref.name}.csv`);
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      } catch {
        return undefined;
      }
      const row = Math.min(ref.row ?? 0, doc.lineCount - 1);
      const charPos = ref.col === undefined ? 0 : csvFieldOffset(doc.lineAt(row).text, ref.col);
      return new vscode.Location(doc.uri, new vscode.Position(row, charPos));
    }

    // 1.6 命令参数中的文件路径 -> 跳转到对应文件 (PosInlist / MonItems 等)
    for (const m of line.matchAll(PATH_TOKEN_RE)) {
      const start = m.index!, end = start + m[0].length;
      if (position.character < start || position.character > end) continue;
      const target = resolveScriptPath(document.uri.fsPath, m[0]);
      if (target) return new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0));
      return undefined;
    }

    // 2. @标签跳转: 当前文件优先, 未命中再搜索其它引擎脚本
    // QueryMsg 的标签参数由引擎追加按钮编号后缀: 点"确定"实际执行 [@标签1]
    const isQueryMsg = /^\s*QueryMsg\s+/i.test(line);
    const atRe = /@([A-Za-z0-9_\-一-鿿]+)/g;
    for (const m of line.matchAll(atRe)) {
      const start = m.index!, end = start + m[0].length;
      if (position.character >= start && position.character <= end) {
        if (/^\s*\[@[^\]]+\]/.test(line)) {
          const refs = await findLabelReferences(document, m[1]);
          if (refs.length === 1) return refs[0];
          if (refs.length > 1) return refs;
          return undefined;
        }
        if (isQueryMsg) {
          const pos1 = labelPosition(document, m[1] + '1');
          if (pos1) return new vscode.Location(document.uri, pos1);
        }
        const pos = labelPosition(document, m[1]);
        if (pos) return new vscode.Location(document.uri, pos);

        const labels = isQueryMsg ? [m[1] + '1', m[1]] : [m[1]];
        for (const label of labels) {
          const locations = await crossFileLabelDefinitions(document, label);
          if (locations.length === 1) return locations[0];
          if (locations.length > 1) return locations;
        }
        return undefined;
      }
    }
    return undefined;
  }
}
