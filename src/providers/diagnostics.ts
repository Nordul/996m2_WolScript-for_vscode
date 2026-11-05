import * as vscode from 'vscode';
import { lintScript } from './diagnosticsCore';

export class M2Diagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('m2script');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  update(document: vscode.TextDocument): void {
    if (document.languageId !== 'm2script' || document.uri.scheme !== 'file') return;
    const fullwidthPunctuation = vscode.workspace.getConfiguration('m2script', document.uri)
      .get<boolean>('diagnostics.fullwidthPunctuation', true);
    const diagnostics = lintScript(document.getText(), { fullwidthPunctuation }).map((item) => {
      const range = new vscode.Range(item.line, item.start, item.line, item.end);
      const severity = item.code === 'fullwidth-punctuation'
        ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, item.message, severity);
      diagnostic.source = '996脚本';
      diagnostic.code = item.code;
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
  }

  schedule(document: vscode.TextDocument, delay = 200): void {
    if (document.languageId !== 'm2script' || document.uri.scheme !== 'file') return;
    const key = document.uri.toString();
    const previous = this.timers.get(key);
    if (previous) clearTimeout(previous);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.update(document);
    }, delay));
  }

  clear(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    this.collection.delete(document.uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.collection.dispose();
  }
}
