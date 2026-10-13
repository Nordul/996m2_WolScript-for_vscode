import * as vscode from 'vscode';

const REF_RE = /@([A-Za-z0-9_\-一-鿿]+)/g;
const DEF_RE = /^\s*\[(@[A-Za-z0-9_\-一-鿿]+)\]/;
const QUERYMSG_RE = /^\s*QueryMsg\s+/i;
const CALL_RE = /^\s*#CALL\b/i;

/** 光标处的标签名(定义行 [@xx] 或引用 @xx 均可) */
export function labelAt(line: string, ch: number): string | undefined {
  const def = line.match(DEF_RE);
  if (def) {
    const start = line.indexOf(def[1]);
    if (ch >= start && ch <= start + def[1].length) return def[1].slice(1);
  }
  for (const m of line.matchAll(REF_RE)) {
    const start = m.index!, end = start + m[0].length;
    if (ch >= start && ch <= end) return m[1];
  }
  return undefined;
}

/**
 * 收集当前文档内全部标签引用: Map<标签名, 引用位置[]>
 * - 定义行 [@xx] 本身不算引用
 * - #CALL 的标签指向其它文件, 不算本文档引用
 * - QueryMsg 的 @xx 由引擎追加按钮后缀, 实际调用 [@xx1], 计入 xx1
 */
export function collectReferences(document: vscode.TextDocument): Map<string, vscode.Range[]> {
  const map = new Map<string, vscode.Range[]>();
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (DEF_RE.test(text) || CALL_RE.test(text)) continue;
    const isQuery = QUERYMSG_RE.test(text);
    for (const m of text.matchAll(REF_RE)) {
      const label = isQuery ? m[1] + '1' : m[1];
      const range = new vscode.Range(i, m.index!, i, m.index! + m[0].length);
      const list = map.get(label);
      if (list) list.push(range);
      else map.set(label, [range]);
    }
  }
  return map;
}

/** Shift+F12 / Ctrl+点击定义处的引用回退: 查找标签的全部调用位置 */
export class M2ReferenceProvider implements vscode.ReferenceProvider {
  provideReferences(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] {
    const name = labelAt(document.lineAt(position.line).text, position.character);
    if (!name) return [];
    const refs = collectReferences(document).get(name) || [];
    return refs.map((r) => new vscode.Location(document.uri, r));
  }
}

/** 每个 [@标签] 上方悬浮 "N 处调用", 点击弹出调用位置列表 */
export class M2LabelCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const refs = collectReferences(document);
    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      const m = text.match(DEF_RE);
      if (!m) continue;
      const pos = new vscode.Position(i, text.indexOf('['));
      const list = refs.get(m[1].slice(1)) || [];
      lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), list.length
        ? {
          title: `$(references) ${list.length} 处调用`,
          command: 'editor.action.showReferences',
          arguments: [document.uri, pos, list.map((r) => new vscode.Location(document.uri, r))],
        }
        : { title: '无调用', command: '' }));
    }
    return lenses;
  }
}
