import * as vscode from 'vscode';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { decodeScript, IGNORE_GLOB, hasHiddenSegment } from '../scanner/scanCore';
import { DropFileModel, parseDropFile, serializeDropFile } from './dropModel';

interface DropFileEntry {
  /** 相对 MonItems 目录的路径（用 / 分隔） */
  rel: string;
  abs: string;
}

export class DropPanel {
  private static current: DropPanel | undefined;

  static show(context: vscode.ExtensionContext, openAbs?: string): void {
    if (DropPanel.current) {
      DropPanel.current.panel.reveal();
      if (openAbs) void DropPanel.current.openFile(openAbs);
      else void DropPanel.current.scan();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.dropManager',
      '爆率管理',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    DropPanel.current = new DropPanel(context, panel, openAbs);
  }

  private files: DropFileEntry[] = [];
  /** abs 路径 -> 已解析模型，物品全局查询时避免重复读盘 */
  private modelCache = new Map<string, DropFileModel>();
  /** 面板就绪后需要自动打开的文件 */
  private pendingOpen?: string;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    openAbs?: string,
  ) {
    this.pendingOpen = openAbs;
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => { DropPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, context.subscriptions);
    panel.webview.html = this.renderHtml();
    // 扫描由 webview 的 ready 消息触发，避免早期消息丢失
  }

  /** 扫描工作区内所有 MonItems 目录下的 txt（忽略 . 开头的目录） */
  private async scan(): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/MonItems/**/*.txt', IGNORE_GLOB);
    this.files = [];
    for (const uri of uris) {
      if (hasHiddenSegment(uri.fsPath)) continue;
      const parts = uri.fsPath.split(/[\\/]/);
      const mi = parts.findIndex((p) => p.toLowerCase() === 'monitems');
      if (mi < 0) continue;
      const relParts = parts.slice(mi + 1);
      this.files.push({ rel: relParts.join('/'), abs: uri.fsPath });
    }
    this.files.sort((a, b) => a.rel.localeCompare(b.rel));
    this.modelCache.clear();
    this.panel.webview.postMessage({ type: 'fileList', files: this.files });
    if (this.pendingOpen) {
      const abs = this.pendingOpen;
      this.pendingOpen = undefined;
      await this.openFile(abs);
    }
  }

  /** 打开并展示指定爆率文件 */
  private async openFile(abs: string): Promise<void> {
    try {
      const model = await this.getModel(abs);
      if (!model) throw new Error('文件读取失败');
      this.panel.webview.postMessage({ type: 'fileData', abs, model });
    } catch (e) {
      this.panel.webview.postMessage({
        type: 'fileData', abs, model: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async getModel(abs: string): Promise<DropFileModel | undefined> {
    const cached = this.modelCache.get(abs);
    if (cached) return cached;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
      const model = parseDropFile(decodeScript(bytes));
      this.modelCache.set(abs, model);
      return model;
    } catch {
      return undefined;
    }
  }

  /** 全局查询包含某物品名的爆率行 */
  private async queryItem(name: string): Promise<unknown[]> {
    const kw = name.trim().toLowerCase();
    if (!kw) return [];
    const results: unknown[] = [];
    for (const f of this.files) {
      if (results.length >= 200) break;
      const model = await this.getModel(f.abs);
      if (!model) continue;
      let n = 0;
      model.items.forEach((it, idx) => {
        if (it.type !== 'drop') return;
        n++;
        if (!it.line.items.some((x) => x.name.toLowerCase().includes(kw))) return;
        results.push({
          abs: f.abs, rel: f.rel, idx, n,
          token: it.line.items.map((x) => (x.noBoost ? '*' : '') + x.name + (x.weight !== undefined ? `,${x.weight}` : '')).join('|'),
          frac: `${it.line.num}/${it.line.den}`,
          p: it.line.p,
        });
      });
    }
    return results;
  }

  private async onMessage(msg: { type: string; abs?: string; model?: DropFileModel }): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.scan();
        break;
      case 'openFile': {
        if (!msg.abs) return;
        await this.openFile(msg.abs);
        break;
      }
      case 'openSource': {
        if (!msg.abs) return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.abs));
        await vscode.window.showTextDocument(doc, { preview: false });
        break;
      }
      case 'queryItem': {
        const q = msg as unknown as { name?: string };
        const results = await this.queryItem(q.name ?? '');
        this.panel.webview.postMessage({ type: 'queryResult', name: q.name, results });
        break;
      }
      case 'save': {
        if (!msg.abs || !msg.model) return;
        const err = await this.save(msg.abs, msg.model);
        if (!err) this.modelCache.set(msg.abs, msg.model);
        this.panel.webview.postMessage(err ? { type: 'saveResult', ok: false, error: err } : { type: 'saveResult', ok: true });
        break;
      }
    }
  }

  private async save(abs: string, model: DropFileModel): Promise<string | undefined> {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty && doc.uri.fsPath === abs) {
        return `${path.basename(abs)} 在编辑器中有未保存的改动，请先保存或还原后再试`;
      }
    }
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(abs), iconv.encode(serializeDropFile(model), 'gbk'));
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private renderHtml(): string {
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    return /* html */ `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .toolbar {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); flex-shrink: 0;
  }
  .toolbar .title { font-weight: 600; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .btn {
    border: none; border-radius: 6px; cursor: pointer; font-size: 12px; padding: 5px 14px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-charts-orange, #e8912d); display: none; }
  .dirty .dot { display: inline-block; }
  .toast { font-size: 12px; }
  .toast.ok { color: var(--vscode-charts-green, #6f6); }
  .toast.err { color: var(--vscode-errorForeground, #f66); }
  .body { flex: 1; display: flex; overflow: hidden; }
  .sidebar {
    width: 260px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .sidebar .search { padding: 10px; }
  .sidebar input[type=text] {
    width: 100%; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .tree { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
  .tnode { user-select: none; }
  .trow {
    display: flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 6px;
    cursor: pointer; font-size: 12px;
  }
  .trow:hover { background: var(--vscode-list-hoverBackground); }
  .trow.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .trow .caret { font-size: 9px; width: 10px; opacity: .7; flex-shrink: 0; }
  .trow .fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tchildren { margin-left: 14px; }
  .tnode.closed > .tchildren { display: none; }

  .main { flex: 1; overflow: hidden; padding: 16px 20px; display: flex; flex-direction: column; }
  .work { flex: 1; display: flex; overflow: hidden; gap: 14px; }
  .edit-area { flex: 1; overflow-y: auto; min-width: 0; }
  .sim-area {
    width: 330px; flex-shrink: 0; overflow-y: auto;
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); padding-left: 14px;
  }
  .empty-hint { opacity: .45; text-align: center; margin-top: 80px; font-size: 13px; }
  .file-head { margin-bottom: 12px; }
  .file-head .fname2 { font-size: 15px; font-weight: 600; }
  .file-head .fpath { font-size: 11px; opacity: .45; margin-top: 2px; }

  table.drops { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  .drops th {
    font-size: 11px; opacity: .55; text-align: left; padding: 5px 10px; font-weight: 600;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
    position: sticky; top: 0; background: var(--vscode-editor-background);
  }
  .drops td { padding: 5px 10px; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.1)); }
  .drops tr.muted td { opacity: .45; }
  .frac { font-family: var(--vscode-editor-font-family); }
  .pct { font-family: var(--vscode-editor-font-family); color: var(--vscode-charts-blue, #4ea1f3); }
  .pct.big { color: var(--vscode-charts-green, #6f6); }
  .pct.tiny { color: var(--vscode-charts-orange, #e8912d); }
  .item-tag {
    display: inline-block; border-radius: 4px; padding: 0 6px; margin: 1px 2px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15)); font-size: 11px;
  }
  .item-tag .w { opacity: .6; font-size: 10px; }
  .item-tag.noboost { outline: 1px dashed var(--vscode-charts-orange, #e8912d); }
  .extras { font-size: 11px; opacity: .55; font-family: var(--vscode-editor-font-family); }
  .call-tag { font-size: 11px; color: var(--vscode-charts-purple, #b180d7); font-family: var(--vscode-editor-font-family); }
  .row-ops { visibility: hidden; white-space: nowrap; }
  tr:hover .row-ops { visibility: visible; }
  .row-ops button {
    border: none; background: none; cursor: pointer; color: inherit; opacity: .6; font-size: 12px; padding: 0 3px;
  }
  .row-ops button:hover { opacity: 1; }
  tr.editing td { background: var(--vscode-list-hoverBackground); }
  .drops input {
    border: 1px solid transparent; border-radius: 5px;
    background: transparent; color: var(--vscode-input-foreground);
    padding: 3px 7px; font-size: 12px; outline: none; width: 100%;
  }
  .drops tr:hover input { background: var(--vscode-input-background); border-color: var(--vscode-input-border, transparent); }
  .drops input:focus { background: var(--vscode-input-background); border-color: var(--vscode-focusBorder); }
  .drops input.invalid { border-color: var(--vscode-inputValidation-errorBorder, #f66); }
  .drops input.num { font-family: var(--vscode-editor-font-family); }
  .drops input.items { font-family: var(--vscode-editor-font-family); }
  .edit-hint { font-size: 10px; opacity: .45; margin-top: 3px; }
  @keyframes flashRow { from { background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,179,8,.35)); } to { background: transparent; } }
  tr.flash { animation: flashRow 1.6s ease-out; }
  .query-bar {
    display: flex; gap: 6px; align-items: center; margin-bottom: 10px;
  }
  .query-bar input, .query-bar select {
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .query-bar input { flex: 1; }
  .qresult { margin-bottom: 12px; }
  .qfile { font-size: 11px; font-weight: 600; opacity: .6; margin: 8px 0 3px; cursor: pointer; }
  .qfile:hover { opacity: 1; text-decoration: underline; }
  .qrow {
    display: flex; gap: 8px; font-size: 12px; padding: 3px 8px; border-radius: 5px;
    cursor: pointer; align-items: baseline;
  }
  .qrow:hover { background: var(--vscode-list-hoverBackground); }
  .qrow .qt { flex: 1; font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qrow .qf { font-family: var(--vscode-editor-font-family); opacity: .6; }
  .sim-opt { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .85; }
  .sim-opt input[type=text] { width: 64px; }
  .splitter { width: 5px; cursor: col-resize; flex-shrink: 0; }
  .splitter:hover, .splitter.active { background: var(--vscode-focusBorder); opacity: .5; }
  .splitter.active { opacity: .8; }

  .sim-bar {
    display: flex; align-items: center; gap: 8px; margin: 6px 0 12px; flex-wrap: wrap;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 8px; padding: 10px 12px;
  }
  .sim-bar input {
    width: 110px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .sim-bar .lbl { font-size: 12px; opacity: .7; }
  .sim-result { margin-top: 4px; }
  .sim-summary { font-size: 12px; opacity: .8; margin-bottom: 8px; }
  .sim-detail-head {
    font-size: 12px; cursor: pointer; user-select: none; opacity: .7; margin: 10px 0 4px;
  }
  .sim-detail-head:hover { opacity: 1; }
  .sim-rounds { font-size: 11px; font-family: var(--vscode-editor-font-family); opacity: .75; line-height: 1.8; }
  .sim-rounds .r { padding: 0 4px; border-radius: 4px; }
  .sim-rounds .r:hover { background: var(--vscode-list-hoverBackground); }
</style>
</head>
<body>
  <div class="toolbar" id="toolbar">
    <span class="title">爆率管理</span>
    <span class="toast" id="toast"></span>
    <span class="spacer"></span>
    <button class="btn secondary" id="refreshBtn" title="重新扫描 MonItems 目录">刷新</button>
    <button class="btn" id="saveBtn"><span class="dot"></span>保存</button>
  </div>
  <div class="body">
    <div class="sidebar" id="dropSidebar">
      <div class="search"><input type="text" id="searchInput" placeholder="搜索爆率文件…"></div>
      <div class="tree" id="tree"></div>
    </div>
    <div class="splitter" id="split1"></div>
    <div class="main" id="main"><div class="empty-hint">在左侧选择一个爆率文件</div></div>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ---- 可拖拽分栏 ----
// dir=1: 目标在分隔条左侧（鼠标右移变宽）；dir=-1: 目标在右侧（鼠标右移变窄）
function makeResizable(splitterId, targetId, stateKey, defWidth, minW, maxW, dir) {
  const sp = $(splitterId), target = $(targetId);
  if (!sp || !target) return;
  const d = dir === undefined ? 1 : dir;
  const saved = (vscode.getState() || {})[stateKey];
  target.style.width = (saved || defWidth) + 'px';
  sp.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sp.classList.add('active');
    const startX = e.clientX;
    const startW = target.getBoundingClientRect().width;
    const onMove = (ev) => {
      const w = Math.max(minW, Math.min(maxW, startW + d * (ev.clientX - startX)));
      target.style.width = w + 'px';
    };
    const onUp = () => {
      sp.classList.remove('active');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const st = vscode.getState() || {};
      st[stateKey] = Math.round(target.getBoundingClientRect().width);
      vscode.setState(st);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
let FILES = [];          // [{rel, abs}]
let current = null;      // 当前文件模型
let currentAbs = '';
let filter = '';
const collapsed = new Set(); // 折叠的目录路径

const $ = (id) => document.getElementById(id);

function fmtPct(p) {
  const pct = p * 100;
  if (pct <= 0) return '0%';
  if (pct < 0.01) return '<0.01%';
  return parseFloat(pct.toFixed(2)) + '%';
}
function pctClass(p) { return p >= 0.1 ? 'big' : p < 0.001 ? 'tiny' : ''; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---- 目录树 ----
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push({ name: parts[parts.length - 1], abs: f.abs, rel: f.rel });
  }
  return root;
}

function renderTree() {
  const kw = filter.trim().toLowerCase();
  const files = kw ? FILES.filter((f) => f.rel.toLowerCase().includes(kw)) : FILES;
  const root = buildTree(files);
  const tree = $('tree');
  tree.innerHTML = '';
  if (!files.length) {
    tree.innerHTML = '<div style="opacity:.45;font-size:12px;padding:8px">'
      + (FILES.length ? '没有匹配的文件' : '未找到 MonItems 目录下的 .txt 文件') + '</div>';
    return;
  }
  const make = (node, container, prefix) => {
    for (const [name, sub] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const dirPath = prefix ? prefix + '/' + name : name;
      const wrap = document.createElement('div');
      wrap.className = 'tnode' + (collapsed.has(dirPath) && !kw ? ' closed' : '');
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = '<span class="caret">' + (wrap.classList.contains('closed') ? '▸' : '▾') + '</span><span class="fname"></span>';
      row.querySelector('.fname').textContent = name;
      row.onclick = () => {
        if (collapsed.has(dirPath)) collapsed.delete(dirPath); else collapsed.add(dirPath);
        renderTree();
      };
      const children = document.createElement('div');
      children.className = 'tchildren';
      wrap.appendChild(row); wrap.appendChild(children);
      container.appendChild(wrap);
      make(sub, children, dirPath);
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('div');
      row.className = 'trow' + (f.abs === currentAbs ? ' selected' : '');
      row.innerHTML = '<span class="caret"></span><span class="fname"></span>';
      row.querySelector('.fname').textContent = f.name.replace(/\\.txt$/i, '');
      row.title = f.rel;
      row.onclick = () => {
        if (dirty && f.abs !== currentAbs) {
          $('toast').textContent = '当前文件有未保存修改，请先保存';
          $('toast').className = 'toast err';
          return;
        }
        currentAbs = f.abs;
        $('main').innerHTML = '<div class="empty-hint">加载中…</div>';
        vscode.postMessage({ type: 'openFile', abs: f.abs });
        renderTree();
      };
      container.appendChild(row);
    }
  };
  make(root, tree, '');
}

// ---- 文件内容 ----
let dirty = false;

function markDirty() {
  dirty = true;
  $('toolbar').classList.add('dirty');
  $('toast').textContent = '';
  $('toast').className = 'toast';
}
function clearDirty() { dirty = false; $('toolbar').classList.remove('dirty'); }

function itemToken(l) {
  return l.items.map((x) => (x.noBoost ? '*' : '') + x.name + (x.weight !== undefined ? ',' + x.weight : '')).join('|');
}
function parseItemToken(token) {
  return token.split('|').map((part) => {
    let s = part.trim();
    let noBoost = false;
    if (s.startsWith('*')) { noBoost = true; s = s.slice(1); }
    let weight;
    const ci = s.lastIndexOf(',');
    if (ci >= 0) {
      const w = Number(s.slice(ci + 1));
      if (!isNaN(w) && s.slice(ci + 1).trim() !== '') { weight = w; s = s.slice(0, ci); }
    }
    return { name: s.trim(), weight, noBoost };
  }).filter((x) => x.name !== '');
}

function rerender() { renderFile(currentAbs, current, undefined, true); }

function renderFile(abs, model, error, keepScroll) {
  const main = $('main');
  if (error || !model) {
    main.innerHTML = '<div class="empty-hint">读取失败：' + esc(error || '未知错误') + '</div>';
    return;
  }
  const editScroll = keepScroll && $('.edit-area') ? $('.edit-area').scrollTop : 0;
  const simHtml = keepScroll && $('simResult') ? $('simResult').innerHTML : '';
  const simRounds = keepScroll && $('simRounds') ? $('simRounds').value : '10000';
  current = model;
  if (!keepScroll) clearDirty();
  const name = abs.split(/[\\\\/]/).pop();
  const dropLines = model.items.filter((it) => it.type === 'drop');

  let html = '<div class="file-head" style="display:flex;align-items:baseline;gap:10px">'
    + '<div style="flex:1;min-width:0"><div class="fname2">' + esc(name.replace(/\\.txt$/i, '')) + '</div>'
    + '<div class="fpath">' + esc(abs) + '</div></div>'
    + '<button class="btn secondary" id="openSrcBtn" title="在编辑器中打开该文件">打开源文件</button></div>';

  html += '<div class="work"><div class="edit-area">';

  // 物品爆率查询
  const qScopeVal = keepScroll && $('qScope') ? $('qScope').value : 'file';
  html += '<div class="query-bar">'
    + '<input type="text" id="qInput" placeholder="输入物品名查询爆率…" value="' + esc(keepScroll && $('qInput') ? $('qInput').value : '') + '">'
    + '<select id="qScope"><option value="file"' + (qScopeVal === 'file' ? ' selected' : '') + '>当前文件</option><option value="global"' + (qScopeVal === 'global' ? ' selected' : '') + '>全局</option></select>'
    + '</div><div class="qresult" id="qResult">' + (keepScroll && $('qResult') ? $('qResult').innerHTML : '') + '</div>';

  html += '<table class="drops"><thead><tr><th style="width:30px">#</th><th>物品（*名称,权重|名称）</th>'
    + '<th style="width:110px">爆率</th><th style="width:70px">百分比</th><th style="width:200px">附加</th><th style="width:26px"></th></tr></thead><tbody>';
  let n = 0;
  model.items.forEach((it, idx) => {
    if (it.type === 'call') {
      html += '<tr class="muted"><td></td><td colspan="5"><span class="call-tag">' + esc(it.text) + '</span>（嵌套调用，不参与模拟）</td></tr>';
      return;
    }
    if (it.type === 'raw') {
      if (it.text.trim()) html += '<tr class="muted"><td></td><td colspan="5" class="extras">' + esc(it.text.trim()) + '</td></tr>';
      return;
    }
    n++;
    const l = it.line;
    html += '<tr id="row-' + idx + '"><td style="opacity:.4">' + n + '</td>'
      + '<td><input class="items" data-f="items" data-idx="' + idx + '"></td>'
      + '<td style="white-space:nowrap"><input class="num" style="width:44px" data-f="num" data-idx="' + idx + '">'
      + ' / <input class="num" style="width:52px" data-f="den" data-idx="' + idx + '"></td>'
      + '<td class="pct ' + pctClass(l.p) + '" id="pct-' + idx + '">' + fmtPct(l.p) + '</td>'
      + '<td><input data-f="extras" data-idx="' + idx + '" placeholder="数量/条件/@脚本"></td>'
      + '<td class="row-ops"><button data-delrow="' + idx + '" title="删除">×</button></td></tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-bottom:16px"><button class="btn secondary" id="addLineBtn">＋ 新增爆率行</button></div>';
  html += '</div>'; // edit-area

  // 右侧模拟区
  const simMult = keepScroll && $('simMult') ? $('simMult').value : '100';
  const simCondChecked = keepScroll && $('simCond') ? $('simCond').checked : true;
  html += '<div class="splitter" id="split2"></div>'
    + '<div class="sim-area" id="simArea"><div class="sim-bar" style="margin-top:0"><span class="lbl">模拟轮数</span>'
    + '<input type="text" id="simRounds" value="' + simRounds + '">'
    + '<button class="btn" id="simBtn">开始模拟</button></div>'
    + '<div class="sim-opt" style="margin-bottom:6px"><span class="lbl">爆率翻倍倍率</span>'
    + '<input type="text" id="simMult" value="' + simMult + '" title="引擎写法：100=不翻倍，200=2倍">'
    + '<span class="lbl" style="opacity:.5">（200=2倍）</span></div>'
    + '<label class="sim-opt" style="margin-bottom:10px;cursor:pointer"><input type="checkbox" id="simCond"' + (simCondChecked ? ' checked' : '') + '>附加条件视为成立（H/G 检测行参与模拟）</label>'
    + '<div class="sim-result" id="simResult">' + simHtml + '</div></div>';
  html += '</div>'; // work
  main.innerHTML = html;
  if (keepScroll && $('.edit-area')) $('.edit-area').scrollTop = editScroll;
  makeResizable('split2', 'simArea', 'simAreaW', 330, 220, 700, -1);

  // 常驻单元格编辑：即改即更新模型
  main.querySelectorAll('input[data-f]').forEach((inp) => {
    const idx = Number(inp.dataset.idx);
    const l = current.items[idx].line;
    // 初值
    if (inp.dataset.f === 'items') inp.value = itemToken(l);
    else if (inp.dataset.f === 'num') inp.value = l.num;
    else if (inp.dataset.f === 'den') inp.value = l.den;
    else inp.value = l.extras;
    inp.oninput = () => {
      if (inp.dataset.f === 'items') {
        const items = parseItemToken(inp.value);
        inp.classList.toggle('invalid', !items.length);
        if (items.length) l.items = items;
      } else if (inp.dataset.f === 'num' || inp.dataset.f === 'den') {
        const num = Math.max(0, parseInt($('main').querySelector('input[data-f="num"][data-idx="' + idx + '"]').value, 10) || 0);
        const denRaw = parseInt($('main').querySelector('input[data-f="den"][data-idx="' + idx + '"]').value, 10);
        const den = Math.max(0, isNaN(denRaw) ? 0 : denRaw);
        l.num = num; l.den = den; l.p = den > 0 ? num / den : 0;
        const pctCell = $('pct-' + idx);
        pctCell.textContent = fmtPct(l.p);
        pctCell.className = 'pct ' + pctClass(l.p);
      } else {
        l.extras = inp.value.trim();
      }
      markDirty();
    };
  });
  $('addLineBtn').onclick = () => {
    current.items.push({ type: 'drop', line: { num: 1, den: 100, items: [{ name: '物品名', noBoost: false }], p: 0.01, extras: '' } });
    markDirty(); rerender();
  };
  main.querySelectorAll('[data-delrow]').forEach((b) => {
    b.onclick = () => {
      current.items.splice(Number(b.dataset.delrow), 1);
      markDirty(); rerender();
    };
  });
  $('simBtn').onclick = () => {
    const rounds = Math.max(1, Math.min(1000000, parseInt($('simRounds').value, 10) || 0));
    $('simRounds').value = rounds;
    const mult = Math.max(0, parseInt($('simMult').value, 10) || 0);
    runSim(dropLines.map((it) => it.line), rounds, mult, $('simCond').checked);
  };
  $('openSrcBtn').onclick = () => vscode.postMessage({ type: 'openSource', abs });
  // 物品查询（防抖）
  let qTimer = null;
  $('qInput').oninput = () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(runQuery, 300);
  };
  $('qScope').onchange = () => runQuery();
}

// ---- 模拟 ----
function hasCond(extras) { return /\b[HG]\s+\$/.test(extras); }
function boostable(l) { return l.items.some((x) => !x.noBoost); }

function runSim(lines, rounds, mult, condPass) {
  const t0 = Date.now();
  const active = lines
    .filter((l) => condPass || !hasCond(l.extras))
    .map((l) => ({ l, p: Math.min(1, boostable(l) ? l.p * (mult / 100) : l.p) }));
  const perRound = [];
  const totals = new Map();
  for (let r = 0; r < rounds; r++) {
    const got = [];
    for (const { l, p } of active) {
      if (p <= 0 || !l.items.length) continue;
      if (Math.random() >= p) continue;
      const totalW = l.items.reduce((s, x) => s + (x.weight === undefined ? 1 : x.weight), 0);
      let pick = Math.random() * totalW;
      let chosen = l.items[l.items.length - 1];
      for (const x of l.items) { pick -= (x.weight === undefined ? 1 : x.weight); if (pick < 0) { chosen = x; break; } }
      got.push(chosen.name);
      totals.set(chosen.name, (totals.get(chosen.name) || 0) + 1);
    }
    perRound.push(got);
  }
  // 理论概率（同一物品多行累加，含翻倍倍率）
  const theory = new Map();
  for (const { l, p } of active) {
    const totalW = l.items.reduce((s, x) => s + (x.weight === undefined ? 1 : x.weight), 0);
    for (const x of l.items) {
      const ip = totalW > 0 ? p * ((x.weight === undefined ? 1 : x.weight) / totalW) : 0;
      theory.set(x.name, (theory.get(x.name) || 0) + ip);
    }
  }
  const skipped = lines.length - active.length;
  const totalDrops = perRound.reduce((s, g) => s + g.length, 0);
  const emptyRounds = perRound.filter((g) => !g.length).length;

  let html = '<div class="sim-summary">共 <b>' + rounds + '</b> 轮，掉落 <b>' + totalDrops + '</b> 件'
    + '（平均每轮 ' + parseFloat((totalDrops / rounds).toFixed(3)) + ' 件，' + emptyRounds + ' 轮空车，耗时 ' + (Date.now() - t0) + 'ms）'
    + (mult !== 100 ? '<br>翻倍倍率 ' + mult + '（整组带 * 的行不受影响）' : '')
    + (skipped > 0 ? '<br>' + skipped + ' 条条件行被跳过' : '')
    + '</div>';
  if (totals.size) {
    html += '<table class="drops"><thead><tr><th>物品</th><th>爆出次数</th><th>实际爆率</th><th>理论爆率</th><th>偏差</th></tr></thead><tbody>';
    for (const [name, count] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
      const actual = count / rounds;
      const t = theory.get(name) || 0;
      const dev = t > 0 ? ((actual - t) / t * 100) : 0;
      html += '<tr><td>' + esc(name) + '</td><td>' + count + '</td>'
        + '<td class="pct">' + fmtPct(actual) + '</td>'
        + '<td class="pct">' + fmtPct(t) + '</td>'
        + '<td style="opacity:.6">' + (dev >= 0 ? '+' : '') + parseFloat(dev.toFixed(1)) + '%</td></tr>';
    }
    html += '</tbody></table>';
    // 每轮明细（仅显示有掉落的轮，最多 500 条）
    const hitRounds = [];
    perRound.forEach((got, i) => { if (got.length) hitRounds.push({ n: i + 1, got }); });
    const cap = 500;
    html += '<div class="sim-detail-head" id="simDetailToggle">▸ 每轮明细（有掉落 ' + hitRounds.length + ' 轮'
      + (hitRounds.length > cap ? '，仅显示前 ' + cap + ' 条' : '') + '）</div>'
      + '<div class="sim-rounds" id="simRoundsList" style="display:none">'
      + hitRounds.slice(0, cap).map((h) => '<div class="r">第 ' + h.n + ' 轮：' + esc(h.got.join('、')) + '</div>').join('')
      + '</div>';
  } else {
    html += '<div class="empty-hint" style="margin-top:20px">' + rounds + ' 轮没有爆出任何物品</div>';
  }
  $('simResult').innerHTML = html;
  $('simMsg').textContent = '';
  const toggle = $('simDetailToggle');
  if (toggle) toggle.onclick = () => {
    const list = $('simRoundsList');
    const show = list.style.display === 'none';
    list.style.display = show ? '' : 'none';
    toggle.textContent = toggle.textContent.replace(/^[▸▾]/, show ? '▾' : '▸');
  };
}

// ---- 物品查询 ----
let pendingFlash = null; // {abs, idx} 打开文件后定位高亮

function flashRow(idx) {
  const el = $('row-' + idx);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth; // 重新触发动画
  el.classList.add('flash');
}

function qRowHtml(abs, idx, n, token, frac, p) {
  return '<div class="qrow" data-abs="' + esc(abs) + '" data-idx="' + idx + '">'
    + '<span style="opacity:.4">#' + n + '</span>'
    + '<span class="qt">' + esc(token) + '</span>'
    + '<span class="qf">' + esc(frac) + '</span>'
    + '<span class="pct">' + fmtPct(p) + '</span></div>';
}

function bindQueryClicks() {
  $('qResult').querySelectorAll('.qrow').forEach((row) => {
    row.onclick = () => {
      const abs = row.dataset.abs;
      const idx = Number(row.dataset.idx);
      if (abs === currentAbs) { flashRow(idx); return; }
      if (dirty) { $('toast').textContent = '当前文件有未保存修改，请先保存'; $('toast').className = 'toast err'; return; }
      pendingFlash = { abs, idx };
      currentAbs = abs;
      $('main').innerHTML = '<div class="empty-hint">加载中…</div>';
      vscode.postMessage({ type: 'openFile', abs });
      renderTree();
    };
  });
}

function runQuery() {
  const name = $('qInput').value.trim();
  if (!name) { $('qResult').innerHTML = ''; return; }
  if ($('qScope').value === 'file') {
    const kw = name.toLowerCase();
    let n = 0;
    let html = '';
    current.items.forEach((it, idx) => {
      if (it.type !== 'drop') return;
      n++;
      if (!it.line.items.some((x) => x.name.toLowerCase().includes(kw))) return;
      html += qRowHtml(currentAbs, idx, n, itemToken(it.line), it.line.num + '/' + it.line.den, it.line.p);
    });
    $('qResult').innerHTML = html || '<div style="font-size:11px;opacity:.5">当前文件没有该物品的爆率行</div>';
    bindQueryClicks();
  } else {
    $('qResult').innerHTML = '<div style="font-size:11px;opacity:.5">全局搜索中…</div>';
    vscode.postMessage({ type: 'queryItem', name });
  }
}

function renderGlobalQuery(results) {
  if (!results.length) {
    $('qResult').innerHTML = '<div style="font-size:11px;opacity:.5">所有 MonItems 文件都没有该物品</div>';
    return;
  }
  // 按文件分组，当前文件排最前
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.abs)) groups.set(r.abs, { rel: r.rel, rows: [] });
    groups.get(r.abs).rows.push(r);
  }
  const sorted = [...groups.entries()].sort((a, b) => (a[0] === currentAbs ? -1 : b[0] === currentAbs ? 1 : 0));
  let html = '';
  for (const [abs, g] of sorted) {
    html += '<div class="qfile" data-abs="' + esc(abs) + '">' + esc(g.rel) + '（' + g.rows.length + '）</div>';
    for (const r of g.rows) html += qRowHtml(abs, r.idx, r.n, r.token, r.frac, r.p);
  }
  $('qResult').innerHTML = html;
  bindQueryClicks();
  $('qResult').querySelectorAll('.qfile').forEach((f) => {
    f.onclick = () => {
      const abs = f.dataset.abs;
      if (abs === currentAbs) return;
      if (dirty) { $('toast').textContent = '当前文件有未保存修改，请先保存'; $('toast').className = 'toast err'; return; }
      currentAbs = abs;
      $('main').innerHTML = '<div class="empty-hint">加载中…</div>';
      vscode.postMessage({ type: 'openFile', abs });
      renderTree();
    };
  });
}

$('searchInput').oninput = (ev) => { filter = ev.target.value; renderTree(); };
$('refreshBtn').onclick = () => vscode.postMessage({ type: 'refresh' });
$('saveBtn').onclick = () => {
  if (!current || !currentAbs) return;
  $('toast').textContent = '保存中…';
  $('toast').className = 'toast';
  vscode.postMessage({ type: 'save', abs: currentAbs, model: current });
};

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg.type === 'fileList') {
    FILES = msg.files;
    renderTree();
  } else if (msg.type === 'fileData') {
    currentAbs = msg.abs;
    dirty = false;
    renderTree();
    renderFile(msg.abs, msg.model, msg.error);
    if (pendingFlash && pendingFlash.abs === msg.abs) {
      flashRow(pendingFlash.idx);
      pendingFlash = null;
    }
  } else if (msg.type === 'queryResult') {
    if ($('qResult')) renderGlobalQuery(msg.results);
  } else if (msg.type === 'saveResult') {
    if (msg.ok) { clearDirty(); $('toast').textContent = '已保存'; $('toast').className = 'toast ok'; }
    else { $('toast').textContent = '保存失败：' + msg.error; $('toast').className = 'toast err'; }
  }
});

makeResizable('split1', 'dropSidebar', 'dropSidebarW', 260, 160, 600);

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
