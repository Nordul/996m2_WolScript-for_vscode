import * as vscode from 'vscode';
import {
  ScanResult, scanText, mergeGroups, sortGroups, isEngineScriptPath, decodeScript,
} from './scanCore';

export { ScanResult, VarRef, isEngineScriptPath, decodeScript } from './scanCore';

export class VarScanner {
  private result: ScanResult = { scannedAt: 0, fileCount: 0, groups: {} };
  private listeners: ((r: ScanResult) => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  onDidScan(listener: (r: ScanResult) => void) { this.listeners.push(listener); }
  getResult(): ScanResult { return this.result; }

  /** 防抖触发全量重扫 */
  scheduleScan(delayMs = 600) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.scanWorkspace(), delayMs);
  }

  async scanWorkspace(): Promise<ScanResult> {
    const groups: ScanResult['groups'] = {};
    let fileCount = 0;
    const folders = vscode.workspace.workspaceFolders;
    const openScanned = new Set<string>();

    // 1. 已打开的 m2script 文档(含未保存内容)
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId !== 'm2script' || doc.uri.scheme !== 'file') continue;
      const rel = folders ? vscode.workspace.asRelativePath(doc.uri) : doc.uri.fsPath;
      mergeGroups(groups, scanText(doc.getText(), rel, doc.uri.fsPath));
      openScanned.add(doc.uri.fsPath);
      fileCount++;
    }

    // 2. 磁盘上的引擎脚本文件
    if (folders) {
      const files = await vscode.workspace.findFiles('**/*.txt', '**/{node_modules,.git,out,dist}/**', 5000);
      for (const uri of files) {
        if (!isEngineScriptPath(uri.fsPath)) continue;
        if (openScanned.has(uri.fsPath)) continue;
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = decodeScript(bytes);
          mergeGroups(groups, scanText(text, vscode.workspace.asRelativePath(uri), uri.fsPath));
          fileCount++;
        } catch { /* 读取失败跳过 */ }
      }
    }

    sortGroups(groups);

    this.result = { scannedAt: Date.now(), fileCount, groups };
    for (const l of this.listeners) l(this.result);
    return this.result;
  }
}
