import * as vscode from 'vscode';
import { MonGenPanel } from './monGenPanel';

export class MonGenCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): void {
    MonGenPanel.attach(this.context, webviewPanel, document.uri);
  }
}
