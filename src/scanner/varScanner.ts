import * as vscode from 'vscode';
import { createHash } from 'crypto';
import {
  ScanResult, ScanGroups, scanText, mergeGroups, sortGroups, isEngineScriptPath, decodeScript,
  IGNORE_GLOB, hasHiddenSegment,
} from './scanCore';
import { isWorkspaceScheme } from '../workspaceUri';

export { ScanResult, VarRef, isEngineScriptPath, decodeScript } from './scanCore';

export interface ScanProgress { done: number; total: number; }

interface IndexedFile {
  mtime: number;
  size: number;
  groups: ScanGroups;
}

interface OpenFile {
  version?: number;
  groups: ScanGroups;
}

interface CachePayload {
  version: number;
  workspace: string;
  scannedAt: number;
  files: ({ key: string } & IndexedFile)[];
}

const CACHE_VERSION = 1;

function uriKey(uri: vscode.Uri): string {
  const fsPath = uri.scheme === 'file' ? uri.fsPath.toLowerCase() : uri.fsPath;
  return `${uri.scheme}|${uri.authority}|${fsPath}`;
}

export class VarScanner implements vscode.Disposable {
  private result: ScanResult = { scannedAt: 0, fileCount: 0, groups: {} };
  private listeners: ((r: ScanResult) => void)[] = [];
  private progressListeners: ((p: ScanProgress | null) => void)[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly documentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly files = new Map<string, IndexedFile>();
  private readonly openFiles = new Map<string, OpenFile>();
  private loadPromise?: Promise<void>;
  private scanning?: Promise<ScanResult>;
  private scanAgain = false;
  private scanForce = false;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly context?: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => void this.updateOpenDocument(doc)),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleOpenDocument(event.document)),
      vscode.workspace.onDidSaveTextDocument((doc) => void this.saveDocument(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => void this.closeDocument(doc.uri)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.openFiles.clear();
        void this.scanWorkspace(true).catch((e) => console.error('[M2Script] 工作区变量索引重建失败:', e));
      }),
    );
    if (typeof vscode.workspace.createFileSystemWatcher === 'function') {
      const watcher = vscode.workspace.createFileSystemWatcher('**/*.{txt,csv}');
      this.disposables.push(
        watcher,
        watcher.onDidCreate((uri) => void this.reindexFile(uri)),
        watcher.onDidChange((uri) => void this.reindexFile(uri)),
        watcher.onDidDelete((uri) => void this.deleteFile(uri)),
      );
    }
  }

  onDidScan(listener: (r: ScanResult) => void) { this.listeners.push(listener); }

  onDidProgress(listener: (p: ScanProgress | null) => void): vscode.Disposable {
    this.progressListeners.push(listener);
    return { dispose: () => { this.progressListeners = this.progressListeners.filter(l => l !== listener); } };
  }

  private emitProgress(p: ScanProgress | null) {
    for (const listener of this.progressListeners) {
      try { listener(p); } catch { /* 忽略监听器异常 */ }
    }
  }

  getResult(): ScanResult { return this.result; }

  async initialize(): Promise<ScanResult> {
    await this.loadCacheOnce();
    return this.scanWorkspace(false);
  }

  scanWorkspace(force = false): Promise<ScanResult> {
    return this.loadCacheOnce().then(() => {
      if (this.scanning) {
        this.scanAgain = true;
        this.scanForce = this.scanForce || force;
        return this.scanning;
      }
      this.scanning = this.scanLoop(force).finally(() => { this.scanning = undefined; });
      return this.scanning;
    });
  }

  private async scanLoop(force: boolean): Promise<ScanResult> {
    let nextForce = force;
    do {
      this.scanAgain = false;
      this.scanForce = false;
      await this.doScan(nextForce);
      nextForce = this.scanForce;
    } while (this.scanAgain);
    return this.result;
  }

  private markScanDirty() {
    if (this.scanning) this.scanAgain = true;
  }

  private async doScan(force: boolean): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    this.syncOpenDocuments();
    if (!folders) {
      this.files.clear();
      this.rebuildResult();
      return;
    }

    try {
      const found = await vscode.workspace.findFiles('**/*.{txt,csv}', IGNORE_GLOB, 5000);
      const diskFiles = found.filter((uri) => isEngineScriptPath(uri.fsPath) && isWorkspaceScheme(uri.scheme) && !hasHiddenSegment(uri.fsPath));
      const foundKeys = new Set(diskFiles.map(uriKey));
      for (const key of this.files.keys()) {
        if (!foundKeys.has(key)) this.files.delete(key);
      }

      const concurrency = folders.some((folder) => folder.uri.scheme === 'vscode-remote') ? 4 : 8;
      let next = 0;
      let done = 0;
      this.emitProgress({ done: 0, total: diskFiles.length });
      const worker = async () => {
        while (next < diskFiles.length) {
          const uri = diskFiles[next++];
          const key = uriKey(uri);
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            const cached = this.files.get(key);
            if (force || !cached || cached.mtime !== stat.mtime || cached.size !== stat.size) {
              const bytes = await vscode.workspace.fs.readFile(uri);
              const rel = vscode.workspace.asRelativePath(uri);
              this.files.set(key, {
                mtime: stat.mtime,
                size: stat.size,
                groups: scanText(decodeScript(bytes), rel, uri.fsPath),
              });
            }
          } catch {
            this.files.delete(key);
          }
          done++;
          if (done % 10 === 0 || done === diskFiles.length) this.emitProgress({ done, total: diskFiles.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, diskFiles.length) }, () => worker()));
      this.syncOpenDocuments();
      this.rebuildResult();
      await this.persistCache();
    } finally {
      this.emitProgress(null);
    }
  }

  private isIndexableDocument(doc: vscode.TextDocument): boolean {
    return isWorkspaceScheme(doc.uri.scheme)
      && !hasHiddenSegment(doc.uri.fsPath)
      && (doc.languageId === 'm2script' || isEngineScriptPath(doc.uri.fsPath));
  }

  private scanOpenDocument(doc: vscode.TextDocument): OpenFile {
    const rel = vscode.workspace.workspaceFolders ? vscode.workspace.asRelativePath(doc.uri) : doc.uri.fsPath;
    return {
      version: typeof doc.version === 'number' ? doc.version : undefined,
      groups: scanText(doc.getText(), rel, doc.uri.fsPath),
    };
  }

  private syncOpenDocuments() {
    const current = new Set<string>();
    for (const doc of vscode.workspace.textDocuments) {
      if (!this.isIndexableDocument(doc)) continue;
      const key = uriKey(doc.uri);
      current.add(key);
      const existing = this.openFiles.get(key);
      const version = typeof doc.version === 'number' ? doc.version : undefined;
      if (!existing || existing.version !== version) this.openFiles.set(key, this.scanOpenDocument(doc));
    }
    for (const key of this.openFiles.keys()) {
      if (!current.has(key)) this.openFiles.delete(key);
    }
  }

  private scheduleOpenDocument(doc: vscode.TextDocument) {
    if (!this.isIndexableDocument(doc)) return;
    const key = uriKey(doc.uri);
    const previous = this.documentTimers.get(key);
    if (previous) clearTimeout(previous);
    this.documentTimers.set(key, setTimeout(() => {
      this.documentTimers.delete(key);
      void this.updateOpenDocument(doc);
    }, 250));
  }

  private async updateOpenDocument(doc: vscode.TextDocument): Promise<void> {
    await this.loadCacheOnce();
    if (!this.isIndexableDocument(doc)) return;
    this.openFiles.set(uriKey(doc.uri), this.scanOpenDocument(doc));
    this.rebuildResult();
    this.markScanDirty();
  }

  private async saveDocument(doc: vscode.TextDocument): Promise<void> {
    await this.loadCacheOnce();
    if (!this.isIndexableDocument(doc)) return;
    const key = uriKey(doc.uri);
    const scanned = this.scanOpenDocument(doc);
    this.openFiles.set(key, scanned);
    try {
      const stat = await vscode.workspace.fs.stat(doc.uri);
      this.files.set(key, { mtime: stat.mtime, size: stat.size, groups: scanned.groups });
    } catch {
      this.files.delete(key);
    }
    this.rebuildResult();
    this.schedulePersist();
    this.markScanDirty();
  }

  private async closeDocument(uri: vscode.Uri): Promise<void> {
    await this.loadCacheOnce();
    this.openFiles.delete(uriKey(uri));
    await this.readFileIntoIndex(uri);
    this.rebuildResult();
    this.schedulePersist();
    this.markScanDirty();
  }

  private async reindexFile(uri: vscode.Uri): Promise<void> {
    await this.loadCacheOnce();
    await this.readFileIntoIndex(uri);
    this.rebuildResult();
    this.schedulePersist();
    this.markScanDirty();
  }

  private async readFileIntoIndex(uri: vscode.Uri): Promise<void> {
    const key = uriKey(uri);
    if (!isWorkspaceScheme(uri.scheme) || !isEngineScriptPath(uri.fsPath) || hasHiddenSegment(uri.fsPath)) {
      this.files.delete(key);
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.files.set(key, {
        mtime: stat.mtime,
        size: stat.size,
        groups: scanText(decodeScript(bytes), vscode.workspace.asRelativePath(uri), uri.fsPath),
      });
    } catch {
      this.files.delete(key);
    }
  }

  private async deleteFile(uri: vscode.Uri): Promise<void> {
    await this.loadCacheOnce();
    this.files.delete(uriKey(uri));
    this.rebuildResult();
    this.schedulePersist();
    this.markScanDirty();
  }

  private rebuildResult(fromCache = false, scannedAt = Date.now()) {
    const groups: ScanGroups = {};
    const keys = new Set([...this.files.keys(), ...this.openFiles.keys()]);
    for (const key of keys) {
      const indexed = this.openFiles.get(key) || this.files.get(key);
      if (indexed) mergeGroups(groups, indexed.groups);
    }
    sortGroups(groups);
    this.result = { scannedAt, fileCount: keys.size, groups, fromCache };
    for (const listener of this.listeners) {
      try { listener(this.result); } catch { /* 忽略监听器异常 */ }
    }
  }

  private workspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    return JSON.stringify(folders.map((folder) => ({
      scheme: folder.uri.scheme,
      authority: folder.uri.authority,
      path: folder.uri.path || folder.uri.fsPath,
    })));
  }

  private cacheUri(): vscode.Uri | undefined {
    if (!this.context?.globalStorageUri || !vscode.workspace.workspaceFolders?.length || typeof vscode.Uri.joinPath !== 'function') return undefined;
    const key = this.workspaceKey();
    const hash = createHash('sha1').update(key).digest('hex');
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'var-index', `${hash}.json`);
  }

  private loadCacheOnce(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.loadCache();
    return this.loadPromise;
  }

  private async loadCache(): Promise<void> {
    const uri = this.cacheUri();
    if (!uri) return;
    try {
      const payload = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as CachePayload;
      if (payload.version !== CACHE_VERSION || payload.workspace !== this.workspaceKey() || !Array.isArray(payload.files)) return;
      for (const entry of payload.files) {
        if (!entry || typeof entry.key !== 'string' || !entry.groups) continue;
        this.files.set(entry.key, { mtime: entry.mtime, size: entry.size, groups: entry.groups });
      }
      this.syncOpenDocuments();
      this.rebuildResult(true, payload.scannedAt);
    } catch {
      // 缓存不存在、损坏或存储不可用时直接后台重建
    }
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistCache().catch(() => undefined);
    }, 400);
  }

  private async persistCache(): Promise<void> {
    const uri = this.cacheUri();
    if (!uri || !this.context?.globalStorageUri) return;
    const directory = vscode.Uri.joinPath(this.context.globalStorageUri, 'var-index');
    const temporary = vscode.Uri.joinPath(directory, `${createHash('sha1').update(this.workspaceKey()).digest('hex')}.tmp`);
    const payload: CachePayload = {
      version: CACHE_VERSION,
      workspace: this.workspaceKey(),
      scannedAt: this.result.scannedAt,
      files: Array.from(this.files, ([key, entry]) => ({ key, ...entry })),
    };
    const write = async () => {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(temporary, new TextEncoder().encode(JSON.stringify(payload)));
      await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
    };
    this.persistChain = this.persistChain.then(write, write);
    return this.persistChain;
  }

  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await this.persistCache();
    await this.persistChain;
  }

  dispose(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    for (const timer of this.documentTimers.values()) clearTimeout(timer);
    this.documentTimers.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
