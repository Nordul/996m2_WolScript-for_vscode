import * as vscode from 'vscode';

const LABEL_RE = /^\s*\[@[^\]]+\]/;

/** [@标签] 段折叠: 从标签行折到下一个标签前(跳过末尾空行) */
export class M2FoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    let start = -1;
    const push = (from: number, to: number) => {
      let end = to;
      while (end > from && !document.lineAt(end).text.trim()) end--;
      if (end > from) ranges.push(new vscode.FoldingRange(from, end, vscode.FoldingRangeKind.Region));
    };
    for (let i = 0; i < document.lineCount; i++) {
      if (LABEL_RE.test(document.lineAt(i).text)) {
        if (start >= 0) push(start, i - 1);
        start = i;
      }
    }
    if (start >= 0) push(start, document.lineCount - 1);
    return ranges;
  }
}
