import * as vscode from 'vscode';
import { MerchantPanel } from './merchantPanel';

export class MerchantCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): void {
    MerchantPanel.attach(this.context, webviewPanel, document.uri);
  }
}
