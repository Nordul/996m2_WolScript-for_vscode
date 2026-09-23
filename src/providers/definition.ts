import * as vscode from 'vscode';
import * as path from 'path';

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
  // 兜底: 工作区内任意 QuestDiary 目录下的文件反推根目录
  const any = await vscode.workspace.findFiles('**/QuestDiary/*.txt', '{**/.*/**,**/.*}', 1);
  if (any.length) return ancestorQuestDiary(any[0].fsPath);
  return undefined;
}

function labelPosition(doc: vscode.TextDocument, label: string): vscode.Position | undefined {
  const re = new RegExp(`^\\s*\\[@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    const m = text.match(re);
    if (m) return new vscode.Position(i, m[0].indexOf('['));
  }
  return undefined;
}

export class M2DefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | undefined> {
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

    // 2. 同文件 @标签 跳转 (GOTO @xxx 等)
    // QueryMsg 的标签参数由引擎追加按钮编号后缀: 点"确定"实际执行 [@标签1]
    const isQueryMsg = /^\s*QueryMsg\s+/i.test(line);
    const atRe = /@([A-Za-z0-9_\-一-鿿]+)/g;
    for (const m of line.matchAll(atRe)) {
      const start = m.index!, end = start + m[0].length;
      if (position.character >= start && position.character <= end) {
        // 标签定义行本身不跳转
        if (/^\s*\[@[^\]]+\]/.test(line)) return undefined;
        if (isQueryMsg) {
          const pos1 = labelPosition(document, m[1] + '1');
          if (pos1) return new vscode.Location(document.uri, pos1);
        }
        const pos = labelPosition(document, m[1]);
        if (pos) return new vscode.Location(document.uri, pos);
        return undefined;
      }
    }
    return undefined;
  }
}
