import * as vscode from 'vscode';
import { findWordMatches, WORD_PATTERN_SOURCE } from './highlightCore';

function isScriptEditor(editor: vscode.TextEditor): boolean {
  return editor.document.languageId === 'm2script' && editor.document.uri.scheme === 'file';
}

function wordAt(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, new RegExp(WORD_PATTERN_SOURCE));
  return range ? document.getText(range) : undefined;
}

/** 点击/移动光标到任意词时, 高亮同文件内相同的词(整词, 忽略大小写) */
export class M2DocumentHighlightProvider implements vscode.DocumentHighlightProvider {
  provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.DocumentHighlight[] {
    const word = wordAt(document, position);
    if (!word) return [];
    return findWordMatches(document.getText(), word).map(({ start, end }) =>
      new vscode.DocumentHighlight(new vscode.Range(document.positionAt(start), document.positionAt(end))),
    );
  }
}

/** 当前词同步高亮到其它可见分屏中的脚本文件 */
export class M2CrossFileHighlighter implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    borderColor: new vscode.ThemeColor('editor.wordHighlightBorder'),
  });
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      vscode.window.onDidChangeTextEditorSelection((e) => this.update(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.update(editor)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.update(vscode.window.activeTextEditor)),
    ];
    this.update(vscode.window.activeTextEditor);
  }

  dispose(): void {
    this.clear();
    this.decoration.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private update(editor: vscode.TextEditor | undefined): void {
    const word = editor && isScriptEditor(editor) ? wordAt(editor.document, editor.selection.active) : undefined;
    if (!editor || !word) {
      this.clear();
      return;
    }
    for (const target of vscode.window.visibleTextEditors) {
      if (target.document === editor.document || !isScriptEditor(target)) {
        target.setDecorations(this.decoration, []);
        continue;
      }
      const ranges = findWordMatches(target.document.getText(), word).map(({ start, end }) =>
        new vscode.Range(target.document.positionAt(start), target.document.positionAt(end)),
      );
      target.setDecorations(this.decoration, ranges);
    }
  }

  private clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
  }
}
