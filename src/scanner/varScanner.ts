import * as vscode from 'vscode';
import {
  ScanResult, scanText, mergeGroups, sortGroups, isEngineScriptPath, decodeScript,
  IGNORE_GLOB, hasHiddenSegment,
} from './scanCore';

export { ScanResult, VarRef, isEngineScriptPath, decodeScript } from './scanCore';

export interface ScanProgress { done: number; total: number; }

export class VarScanner {
  private result: ScanResult = { scannedAt: 0, fileCount: 0, groups: {} };
  private listeners: ((r: ScanResult) => void)[] = [];
  private progressListeners: ((p: ScanProgress | null) => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scanning: Promise<ScanResult> | undefined;

  onDidScan(listener: (r: ScanResult) => void) { this.listeners.push(listener); }
  /** 扫描进度回调; p 为 null 表示扫描结束 */
  onDidProgress(listener: (p: ScanProgress | null) => void): vscode.Disposable {
    this.progressListeners.push(listener);
    return { dispose: () => { this.progressListeners = this.progressListeners.filter(l => l !== listener); } };
  }
  /** 监听器异常不能中断扫描 */
  private emitProgress(p: ScanProgress | null) {
    for (const l of this.progressListeners) { try { l(p); } catch { /* 忽略监听器异常 */ } }
  }
  getResult(): ScanResult { return this.result; }

  /** 防抖触发全量重扫 */
  scheduleScan(delayMs = 600) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.scanWorkspace(), delayMs);
  }

  /** 全量扫描; 已有扫描进行中时复用同一 Promise, 避免并发重扫 */
  scanWorkspace(): Promise<ScanResult> {
    if (!this.scanning) {
      this.scanning = this.doScan().finally(() => { this.scanning = undefined; });
    }
    return this.scanning;
  }

  private async doScan(): Promise<ScanResult> {
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

    // 2. 磁盘上的引擎脚本文件 (排除 .开头的文件/文件夹, 如 .history/.git 缓存)
    if (folders) {
      try {
        // 注意: glob 不允许嵌套花括号, 排除模式必须平铺
        const found = await vscode.workspace.findFiles('**/*.txt', IGNORE_GLOB, 5000);
        // 兜底: 路径任意一段以 . 开头都跳过
        const files = found.filter(uri => isEngineScriptPath(uri.fsPath) && !openScanned.has(uri.fsPath) && !hasHiddenSegment(uri.fsPath));
        let done = 0;
        this.emitProgress({ done: 0, total: files.length });
        for (const uri of files) {
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = decodeScript(bytes);
            mergeGroups(groups, scanText(text, vscode.workspace.asRelativePath(uri), uri.fsPath));
            fileCount++;
          } catch { /* 读取失败跳过 */ }
          done++;
          if (done % 10 === 0 || done === files.length) this.emitProgress({ done, total: files.length });
        }
      } finally {
        this.emitProgress(null);
      }
    }

    sortGroups(groups);

    this.result = { scannedAt: Date.now(), fileCount, groups };
    for (const l of this.listeners) { try { l(this.result); } catch { /* 忽略监听器异常 */ } }
    return this.result;
  }
}
