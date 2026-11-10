import * as vscode from 'vscode';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import type { WorkBook } from 'xlsx';
import { decodeScript } from '../scanner/scanCore';
import {
  MonGenModel, MON_GEN_COLUMNS, parseMonGen, serializeMonGen, monGenNeedsAlignment,
} from './monGenModel';
import { parseMonGenWorkbook, serializeMonGenWorkbook } from './monGenXls';
import { parseMapInfo, mapInfoEntries } from './mapModel';

export class MonGenPanel {
  private static current: MonGenPanel | undefined;

  static show(context: vscode.ExtensionContext, file: vscode.Uri): void {
    if (MonGenPanel.current) {
      MonGenPanel.current.panel.reveal();
      MonGenPanel.current.setFile(file);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.monGenManager',
      '刷怪管理器',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MonGenPanel.current = new MonGenPanel(context, panel, file);
  }

  static attach(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, file: vscode.Uri): void {
    panel.webview.options = { enableScripts: true };
    new MonGenPanel(context, panel, file);
  }

  private fileUri!: vscode.Uri;
  private sourceUri!: vscode.Uri;
  private sourceKind: 'txt' | 'xls' = 'txt';
  private model!: MonGenModel;
  private xlsWorkbook?: WorkBook;
  private xlsSheetName = '';
  private loadError?: string;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    file: vscode.Uri,
  ) {
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => {
      if (MonGenPanel.current === this) MonGenPanel.current = undefined;
    }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, context.subscriptions);
    panel.webview.html = this.renderHtml();
    this.setFile(file);
  }

  private setFile(file: vscode.Uri): void {
    this.fileUri = file;
    void this.load();
  }

  private configRootUri(): vscode.Uri {
    const parent = vscode.Uri.joinPath(this.fileUri, '..');
    if (path.basename(this.fileUri.fsPath).toLowerCase() === 'mongen.xls'
      && path.basename(parent.fsPath).toLowerCase() === 'data') {
      return vscode.Uri.joinPath(parent, '..');
    }
    return parent;
  }

  private async findMonGenXls(): Promise<vscode.Uri | undefined> {
    if (path.basename(this.fileUri.fsPath).toLowerCase() === 'mongen.xls') return this.fileUri;
    const root = this.configRootUri();
    try {
      const entries = await vscode.workspace.fs.readDirectory(root);
      const dataDir = entries.find(([name, type]) =>
        name.toLowerCase() === 'data' && (type & vscode.FileType.Directory) !== 0);
      if (!dataDir) return undefined;
      const dataUri = vscode.Uri.joinPath(root, dataDir[0]);
      const files = await vscode.workspace.fs.readDirectory(dataUri);
      const xls = files.find(([name, type]) =>
        name.toLowerCase() === 'mongen.xls' && (type & vscode.FileType.File) !== 0);
      return xls ? vscode.Uri.joinPath(dataUri, xls[0]) : undefined;
    } catch {
      return undefined;
    }
  }

  private async load(): Promise<void> {
    let model: MonGenModel = { items: [] };
    let messy = false;
    this.loadError = undefined;
    this.xlsWorkbook = undefined;
    this.xlsSheetName = '';
    const xlsUri = await this.findMonGenXls();
    if (xlsUri) {
      this.sourceUri = xlsUri;
      this.sourceKind = 'xls';
      try {
        const parsed = parseMonGenWorkbook(await vscode.workspace.fs.readFile(xlsUri));
        model = parsed.model;
        this.xlsWorkbook = parsed.workbook;
        this.xlsSheetName = parsed.sheetName;
      } catch (e) {
        this.loadError = `读取 ${path.basename(xlsUri.fsPath)} 失败：${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      this.sourceUri = this.fileUri;
      this.sourceKind = 'txt';
      try {
        const text = decodeScript(await vscode.workspace.fs.readFile(this.fileUri));
        model = parseMonGen(text);
        messy = monGenNeedsAlignment(text);
      } catch {
        model = { items: [] };
      }
    }
    this.model = model;
    const mapNames: Record<string, string> = {};
    try {
      const miBytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.configRootUri(), 'MapInfo.txt'),
      );
      for (const e of mapInfoEntries(parseMapInfo(decodeScript(miBytes)))) {
        mapNames[e.id.toUpperCase()] = e.name;
      }
    } catch { /* MapInfo.txt 不存在则跳过 */ }
    this.panel.title = `刷怪管理器 - ${path.basename(this.sourceUri.fsPath)}`;
    this.panel.webview.postMessage({
      type: 'load',
      model,
      columns: MON_GEN_COLUMNS,
      filePath: this.sourceUri.fsPath,
      sourceKind: this.sourceKind,
      mapNames,
      messy,
      loadError: this.loadError,
    });
  }

  private async onMessage(msg: { type: string; model?: MonGenModel }): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.load();
        break;
      case 'save': {
        if (!msg.model) return;
        const err = await this.save(msg.model);
        this.panel.webview.postMessage(err ? { type: 'saveResult', ok: false, error: err } : { type: 'saveResult', ok: true });
        break;
      }
    }
  }

  private async save(model: MonGenModel): Promise<string | undefined> {
    if (this.loadError) return this.loadError;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty && doc.uri.fsPath === this.sourceUri.fsPath) {
        return `${path.basename(this.sourceUri.fsPath)} 在编辑器中有未保存的改动，请先保存或还原后再试`;
      }
    }
    try {
      if (this.sourceKind === 'xls' && this.xlsWorkbook) {
        const bytes = serializeMonGenWorkbook(model, this.xlsWorkbook, this.xlsSheetName);
        await vscode.workspace.fs.writeFile(this.sourceUri, bytes);
      } else {
        await vscode.workspace.fs.writeFile(this.sourceUri, iconv.encode(serializeMonGen(model), 'gbk'));
      }
      this.model = model;
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
    display: flex; align-items: center; gap: 10px; padding: 9px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); flex-shrink: 0;
  }
  .title { font-weight: 600; font-size: 13px; white-space: nowrap; }
  .source-badge {
    font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .source-badge.xls { background: var(--vscode-charts-green, #47894f); color: white; }
  .path { font-size: 11px; opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .btn {
    border: none; border-radius: 5px; cursor: pointer; font-size: 12px; padding: 5px 13px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .btn.danger { background: transparent; color: var(--vscode-errorForeground, #f66); padding: 2px 6px; }
  .btn.danger:hover { background: rgba(255,80,80,.12); }
  .btn:disabled { opacity: .45; cursor: default; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-charts-orange, #e8912d); display: none; }
  .dirty .dot { display: inline-block; }
  .toast { font-size: 12px; padding: 0 4px; white-space: nowrap; }
  .toast.ok { color: var(--vscode-charts-green, #6f6); }
  .toast.err { color: var(--vscode-errorForeground, #f66); }
  .notice {
    display: flex; align-items: center; gap: 10px; padding: 6px 12px; font-size: 12px; flex-shrink: 0;
    background: var(--vscode-inputValidation-warningBackground, rgba(200,150,40,.12));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .notice.error {
    background: var(--vscode-inputValidation-errorBackground, rgba(200,40,40,.12));
    color: var(--vscode-errorForeground, #f66);
  }
  .notice span { flex: 1; }
  .filters {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-shrink: 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .filters input[type=text], .filters select {
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 5px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 8px; font-size: 12px; outline: none;
  }
  #searchInput { width: 260px; }
  #mapFilter { max-width: 210px; }
  .qchip {
    font-size: 11px; padding: 3px 10px; border-radius: 11px; cursor: pointer; user-select: none;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); opacity: .7;
  }
  .qchip.on {
    opacity: 1; border-color: var(--vscode-button-background);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .filter-spacer { flex: 1; }
  .table-wrap { flex: 1; overflow: auto; position: relative; }
  table { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
  th, td {
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.18));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.18));
    padding: 0; height: 30px; overflow: hidden;
  }
  th {
    position: sticky; top: 0; z-index: 3; height: 34px; padding: 0; text-align: left;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .th-box { position: relative; display: flex; align-items: center; height: 100%; padding: 0 7px; }
  .col-resizer {
    position: absolute; top: 0; bottom: 0; right: 0; width: 8px;
    cursor: col-resize; z-index: 4; user-select: none;
  }
  .col-resizer:hover { background: var(--vscode-focusBorder); opacity: .55; }
  tbody tr:nth-child(even) td { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.035)); }
  tbody tr:hover td, tbody tr.selected td { background: var(--vscode-list-hoverBackground); }
  td.cell-input { position: relative; }
  td.cell-view {
    padding: 0 7px; height: 29px; line-height: 29px;
    font-family: var(--vscode-editor-font-family); font-size: 12px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  td.cell-selected { background: var(--vscode-list-activeSelectionBackground, rgba(70,130,180,.30)) !important; }
  td input {
    width: 100%; height: 29px; border: 1px solid transparent; border-radius: 0; outline: none;
    padding: 3px 7px; background: transparent; color: var(--vscode-editor-foreground, var(--vscode-foreground));
    font-family: var(--vscode-editor-font-family); font-size: 12px;
  }
  td input:focus { border-color: var(--vscode-focusBorder); background: var(--vscode-input-background); }
  td.row-no { text-align: center; opacity: .45; font-size: 11px; user-select: none; cursor: pointer; }
  th.row-no, th.op-col { text-align: center; }
  td.op-cell { text-align: center; }
  .del-row { border: none; background: transparent; color: inherit; opacity: .35; cursor: pointer; font-size: 15px; }
  .del-row:hover { opacity: 1; color: var(--vscode-errorForeground, #f66); }
  td.smart-cell { text-align: center; }
  .smart-cell input { width: 14px; height: 14px; padding: 0; accent-color: var(--vscode-button-background); cursor: pointer; }
  .empty { text-align: center; opacity: .45; padding: 60px 20px; }
  tr.raw-row td { height: 26px; }
  tr.raw-row .raw-cell {
    font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .55;
    padding: 3px 8px; white-space: pre-wrap; word-break: break-all; user-select: text;
    background: transparent !important;
  }
  tr.raw-row:hover .raw-cell { background: var(--vscode-list-hoverBackground) !important; }
  .ctx-menu {
    position: fixed; z-index: 20; display: none; min-width: 130px;
    background: var(--vscode-editorWidget-background, #2a2a2a);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
    border-radius: 6px; padding: 4px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .ctx-item { padding: 5px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .ctx-item:hover { background: var(--vscode-list-hoverBackground); }
  .ctx-sep { height: 1px; margin: 3px 6px; background: var(--vscode-panel-border, rgba(128,128,128,.3)); }
  .statusbar {
    display: flex; align-items: center; gap: 12px; padding: 5px 12px; font-size: 11px; opacity: .6;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); flex-shrink: 0;
  }
  .statusbar .grow { flex: 1; }
  .pager { display: inline-flex; align-items: center; gap: 4px; }
  .page-btn {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); background: transparent;
    color: inherit; border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 7px;
  }
  .page-btn:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .page-btn:disabled { opacity: .35; cursor: default; }
  body.col-dragging { cursor: col-resize; }
  body.col-dragging * { user-select: none !important; }
</style>
</head>
<body>
  <div class="toolbar" id="toolbar">
    <span class="title">刷怪管理器</span>
    <span class="source-badge" id="sourceBadge">TXT</span>
    <span class="path" id="pathHint"></span>
    <span class="toast" id="toast"></span>
    <button class="btn secondary" id="refreshBtn" title="从磁盘重新加载">刷新</button>
    <button class="btn" id="saveBtn"><span class="dot"></span>保存</button>
  </div>
  <div class="notice" id="alignNotice" style="display:none">
    <span>检测到 TXT 使用 TAB 或不规则空格，建议整理为单空格分隔</span>
    <button class="btn secondary" id="alignBtn">自动对齐</button>
    <button class="btn danger" id="alignDismiss" title="忽略">×</button>
  </div>
  <div class="notice error" id="loadErrorNotice" style="display:none"><span id="loadErrorText"></span></div>
  <div class="filters">
    <input type="text" id="searchInput" placeholder="搜索地图 / 怪物名 / 重命名…">
    <select id="mapFilter" title="按地图筛选"><option value="">全部地图</option></select>
    <span class="qchip" id="smartFilter">智能刷怪</span>
    <span class="filter-spacer"></span>
    <button class="btn secondary" id="addRowBtn">＋ 新增刷怪</button>
  </div>
  <div class="table-wrap" id="tableWrap"></div>
  <div class="statusbar">
    <span id="rowCount">0 条记录</span>
    <span class="pager">
      <button class="page-btn" id="prevPage" title="上一页">‹</button>
      <span id="pageInfo">1/1 页</span>
      <button class="page-btn" id="nextPage" title="下一页">›</button>
    </span>
    <span>Enter 下一行 · 拖动列边界调宽 · 双击边界自适应 · Ctrl+/ 注释行</span>
    <span class="grow"></span>
    <span id="sourceHint"></span>
  </div>
  <div class="ctx-menu" id="ctxMenu"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let MODEL = { items: [] };
let COLUMNS = [];
let MAPNAMES = {};
let selected = -1;
let filter = '';
let smartOnly = false;
let dirty = false;
let page = 1;
let SOURCEKIND = 'txt';
const PAGE_SIZE = 100;
let columnWidths = [];
let manualColumnWidths = (vscode.getState() || {}).genManualColumnWidths || {};
let undoStack = [];
let redoStack = [];
let typingUndoArmed = true;
const measureContext = document.createElement('canvas').getContext('2d');

function measureText(value) {
  measureContext.font = '12px ' + getComputedStyle(document.body).fontFamily;
  return measureContext.measureText(String(value || '')).width;
}
function autoColumnWidth(i) {
  let width = measureText(COLUMNS[i].label) + 30;
  for (const { r } of rows()) {
    const value = i === 0 ? mapIdOf(r) : field(r, i);
    width = Math.max(width, measureText(value) + 22);
    if (width >= 360) break;
  }
  return Math.ceil(Math.max(64, Math.min(360, width)));
}
function ensureColumnWidths() {
  const saved = (vscode.getState() || {}).genColumnWidths || {};
  columnWidths = COLUMNS.map((_, i) => manualColumnWidths[i] && saved[i] ? saved[i] : autoColumnWidth(i));
}
function persistColumnWidths() {
  const state = vscode.getState() || {};
  state.genColumnWidths = columnWidths.slice();
  state.genManualColumnWidths = manualColumnWidths;
  vscode.setState(state);
}
function setColumnWidth(i, width) {
  columnWidths[i] = width;
  const wrap = $('tableWrap');
  const col = wrap.querySelector('col[data-column="' + i + '"]');
  if (col) col.style.width = width + 'px';
  // 固定布局下三重保险：col / 表头单元格 / 首行数据单元格任一生效即可驱动列宽
  const cellIndex = i + 3;
  const header = wrap.querySelector('thead tr th:nth-child(' + cellIndex + ')');
  if (header) header.style.width = width + 'px';
  const firstCell = wrap.querySelector('tbody tr:not(.raw-row) td:nth-child(' + cellIndex + ')');
  if (firstCell) firstCell.style.width = width + 'px';
  // 同步表格总宽（#45 + 智能50 + 23 数据列 + 操作48），col 宽度的分配基准
  const tableEl = wrap.querySelector('table');
  if (tableEl) tableEl.style.width = (143 + columnWidths.reduce((a, b) => a + b, 0)) + 'px';
}
function startColumnDrag(ev, i) {
  ev.preventDefault(); ev.stopPropagation();
  const startX = ev.clientX, startWidth = columnWidths[i];
  manualColumnWidths[i] = true;
  // 指针捕获：即使指针移出把手/表格，拖动仍持续接收事件
  try {
    if (ev.pointerId !== undefined && ev.target && ev.target.setPointerCapture) {
      ev.target.setPointerCapture(ev.pointerId);
    }
  } catch { /* 环境不支持时退化为 window 监听 */ }
  document.body.classList.add('col-dragging');
  let lastX = startX;
  let pending = null;
  const apply = () => {
    pending = null;
    setColumnWidth(i, Math.max(64, Math.min(720, startWidth + lastX - startX)));
  };
  const onMove = (moveEv) => {
    lastX = moveEv.clientX;
    if (pending === null) pending = requestAnimationFrame(apply);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (pending !== null) cancelAnimationFrame(pending);
    apply();
    document.body.classList.remove('col-dragging');
    persistColumnWidths();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
function resetColumnWidth(ev, i) {
  ev.preventDefault(); ev.stopPropagation();
  delete manualColumnWidths[i];
  setColumnWidth(i, autoColumnWidth(i));
  persistColumnWidths();
}
function nearRightEdge(el, clientX) {
  const rect = el.getBoundingClientRect();
  return Math.abs(clientX - rect.right) <= 8;
}
function addColumnResize(th, i) {
  const box = document.createElement('div');
  box.className = 'th-box';
  const label = document.createElement('span');
  label.textContent = COLUMNS[i].label;
  const grip = document.createElement('span');
  grip.className = 'col-resizer';
  grip.title = '拖动调整列宽，双击自适应内容';
  grip.onpointerdown = (ev) => startColumnDrag(ev, i);
  grip.ondblclick = (ev) => resetColumnWidth(ev, i);
  box.appendChild(label); box.appendChild(grip);
  // 兜底：Webview 渲染差异导致把手难以命中时，表头右缘 8px 仍可拖动/双击
  th.addEventListener('pointerdown', (ev) => {
    if (ev.target !== grip && nearRightEdge(th, ev.clientX)) startColumnDrag(ev, i);
  });
  th.addEventListener('dblclick', (ev) => {
    if (ev.target !== grip && nearRightEdge(th, ev.clientX)) resetColumnWidth(ev, i);
  });
  th.appendChild(box);
}

function mapName(id) { return MAPNAMES[String(id).toUpperCase()] || ''; }
function markDirty() { dirty = true; $('toolbar').classList.add('dirty'); $('toast').textContent = ''; }
function clearDirty() { dirty = false; $('toolbar').classList.remove('dirty'); }
function pushUndo() {
  undoStack.push(JSON.stringify(MODEL));
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
}
function applyModelSnapshot(snapshot) {
  MODEL = JSON.parse(snapshot);
  cellSel = null;
  selected = -1;
  markDirty();
  renderTable();
}
function undoEdit() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(MODEL));
  applyModelSnapshot(undoStack.pop());
  $('toast').textContent = '已撤销'; $('toast').className = 'toast ok';
}
function redoEdit() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(MODEL));
  applyModelSnapshot(redoStack.pop());
  $('toast').textContent = '已重做'; $('toast').className = 'toast ok';
}
/** 单元格按下/拖动选择；# 列、按钮列、智能列、编辑中单元格不响应 */
function attachRowSelect(tr, idx) {
  tr.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const t = ev.target;
    if (t.closest && (t.closest('td.cell-edit') || t.closest('td.op-cell') || t.closest('td.smart-cell') || t.closest('td.row-no'))) return;
    const cellTd = t.closest && t.closest('td.cell-view');
    if (!cellTd) return;
    ev.preventDefault();
    startCellDrag(ev, idx, parseInt(cellTd.dataset.col, 10), cellTd);
  });
}
let cellSel = null;   // { aIdx, aCol, bIdx, bCol } 单元格矩形选择（a 为按下角，b 为拖动角）
function cellSelRange() {
  if (!cellSel) return null;
  const list = visibleEntries().filter((e) => e.kind === 'row').map((e) => e.idx);
  const ia = list.indexOf(cellSel.aIdx), ib = list.indexOf(cellSel.bIdx);
  if (ia < 0 || ib < 0) return null;
  return { from: Math.min(ia, ib), to: Math.max(ia, ib), c1: Math.min(cellSel.aCol, cellSel.bCol), c2: Math.max(cellSel.aCol, cellSel.bCol), idxs: list };
}
function cellAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const td = el && el.closest ? el.closest('td.cell-view') : null;
  if (!td || td.dataset.idx === undefined) return null;
  return { idx: parseInt(td.dataset.idx, 10), col: parseInt(td.dataset.col, 10) };
}
/** 单元格区域拖动选择矩形范围；按下不重建表格（保持节点稳定以便双击编辑），只差异更新高亮 class */
let manualDbl = null;
function startCellDrag(ev, idx, col, td) {
  commitActiveEditor();   // 点击其他地方退出编辑模式（preventDefault 会阻止自然 blur）
  const now = Date.now();
  if (manualDbl && now - manualDbl.t < 450 && manualDbl.idx === idx && manualDbl.col === col) {
    manualDbl = null;
    beginEdit(td);
    return;
  }
  manualDbl = { t: now, idx, col };
  let lastRange = cellSelRange();
  cellSel = { aIdx: idx, aCol: col, bIdx: idx, bCol: col };
  const tbody = $('tableWrap').querySelector('tbody');
  const trList = tbody ? Array.from(tbody.children) : [];
  let pos = -1;
  const rowPos = trList.map((tr) => (tr.classList.contains('raw-row') ? -1 : ++pos));
  const inRect = (r, p, c) => p >= r.from && p <= r.to && c >= r.c1 && c <= r.c2;
  let pending = null;
  const paint = () => {
    pending = null;
    const nr = cellSelRange();
    if (!nr) return;
    trList.forEach((tr, i) => {
      const p = rowPos[i];
      if (p < 0) return;
      for (let c = 0; c < COLUMNS.length; c++) {
        const was = lastRange ? inRect(lastRange, p, c) : false;
        if (was !== inRect(nr, p, c)) {
          const cell = tr.cells[2 + c];
          if (cell) cell.classList.toggle('cell-selected', !was);
        }
      }
    });
    lastRange = nr;
  };
  paint();
  const onMove = (mv) => {
    const c = cellAtPoint(mv.clientX, mv.clientY);
    if (c && cellSel && (c.idx !== cellSel.bIdx || c.col !== cellSel.bCol)) {
      cellSel.bIdx = c.idx;
      cellSel.bCol = c.col;
      if (pending === null) pending = requestAnimationFrame(paint);
    }
  };
  const onUp = () => {
    if (pending !== null) cancelAnimationFrame(paint);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
let clipText = '';
/** Ctrl+C：单元格值 / 单元格区域 TSV / 选中行整行 TSV */
function copySelection() {
  const range = cellSelRange();
  if (range) {
    const lines = [];
    for (let i = range.from; i <= range.to; i++) {
      const it = MODEL.items[range.idxs[i]];
      if (it && it.type === 'row') {
        const vals = [];
        for (let c = range.c1; c <= range.c2; c++) vals.push(field(it.row, c));
        lines.push(vals.join('\t'));
      }
    }
    clipText = lines.join('\\n');
  } else if (selected >= 0 && MODEL.items[selected] && MODEL.items[selected].type === 'row') {
    clipText = COLUMNS.map((_, c) => field(MODEL.items[selected].row, c)).join('\t');
  } else return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) void navigator.clipboard.writeText(clipText);
  } catch { /* 无权限时仅内部剪贴板可用 */ }
  $('toast').textContent = '已复制 ' + clipText.split('\\n').length + ' 行'; $('toast').className = 'toast ok';
}
/** Ctrl+V：单值填满选中范围；多值网格按左上角平铺循环填充 */
function pasteIntoSelection() {
  const doPaste = (text) => {
    const range = cellSelRange();
    if (!range || !text) return;
    const grid = String(text).replace(/\\r/g, '').split('\\n')
      .filter((l, i, a) => l !== '' || i < a.length - 1)
      .map((l) => l.split('\t'));
    if (!grid.length || !grid[0].length) return;
    pushUndo();
    const selRows = range.to - range.from + 1, selCols = range.c2 - range.c1 + 1;
    const single = grid.length === 1 && grid[0].length === 1;
    let rows = selRows, cols = selCols;
    let autoFill = false;
    if (selRows === 1 && selCols === 1 && !single) {
      // 单元格锚点 + 多格数据：向后自动填充；列数不超过最大列，行数不超过剩余数据行
      rows = Math.min(grid.length, range.idxs.length - range.from);
      cols = Math.min(grid[0].length, COLUMNS.length - range.c1);
      autoFill = true;
      cellSel = { aIdx: range.idxs[range.from], aCol: range.c1, bIdx: range.idxs[range.from + rows - 1], bCol: range.c1 + cols - 1 };
    }
    let n = 0;
    for (let r = 0; r < rows; r++) {
      const it = MODEL.items[range.idxs[range.from + r]];
      if (!it || it.type !== 'row') continue;
      for (let c = 0; c < cols; c++) {
        const v = single ? grid[0][0]
          : autoFill ? (grid[r][c] === undefined ? '' : grid[r][c])
            : (grid[r % grid.length][c % grid[0].length] === undefined ? '' : grid[r % grid.length][c % grid[0].length]);
        setField(it.row, range.c1 + c, v);
      }
      n++;
    }
    markDirty(); renderTable();
    $('toast').textContent = '已粘贴 ' + n + ' 行 × ' + cols + ' 列'; $('toast').className = 'toast ok';
  };
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((t) => doPaste(t || clipText)).catch(() => doPaste(clipText));
      return;
    }
  } catch { /* 无权限时用内部剪贴板 */ }
  doPaste(clipText);
}
function field(row, i) {
  const v = row.fields[i] !== undefined ? row.fields[i] : '';
  return v === ';' ? '' : v;
}
function mapIdOf(r) { const v = field(r, 0); return v.startsWith('*') ? v.slice(1) : v; }
function isSmart(r) { return field(r, 0).startsWith('*'); }
function setField(row, i, v) {
  while (row.fields.length < i) row.fields.push('');
  row.fields[i] = v;
}
function rows() {
  const out = [];
  let no = 0;
  MODEL.items.forEach((it, idx) => { if (it.type === 'row') out.push({ idx, no: ++no, r: it.row }); });
  return out;
}
function refreshMapFilter() {
  const sel = $('mapFilter');
  const cur = sel.value;
  const seen = new Set();
  sel.innerHTML = '<option value="">全部地图</option>';
  for (const { r } of rows()) {
    const id = mapIdOf(r), up = id.toUpperCase();
    if (!id || seen.has(up)) continue;
    seen.add(up);
    const opt = document.createElement('option');
    opt.value = up;
    opt.textContent = id + (mapName(id) ? ' ' + mapName(id) : '');
    sel.appendChild(opt);
  }
  sel.value = cur;
  if (sel.value !== cur) sel.value = '';
}
function isCommentText(text) { return /^\\s*(?:\\/\\/|;|；)/.test(String(text || '')); }
function visibleEntries() {
  const kw = filter.trim().toLowerCase();
  const mapFilter = $('mapFilter').value;
  const out = [];
  let no = 0;
  MODEL.items.forEach((it, idx) => {
    if (it.type === 'row') {
      const dataNo = ++no;
      const r = it.row;
      const mapId = mapIdOf(r), name = field(r, 3);
      if (smartOnly && !isSmart(r)) return;
      if (mapFilter && mapId.toUpperCase() !== mapFilter) return;
      if (kw && !(mapId.toLowerCase().includes(kw) || name.toLowerCase().includes(kw)
        || mapName(mapId).toLowerCase().includes(kw) || field(r, 9).toLowerCase().includes(kw))) return;
      out.push({ kind: 'row', idx, no: dataNo, r });
    } else {
      const text = String(it.text || '');
      if (!isCommentText(text)) return;   // 仅注释行显示；空行/坏行/XLS 表头保持隐藏
      if (mapFilter || smartOnly) return; // 地图/智能过滤视图下注释行无所属，隐藏
      if (kw && !text.toLowerCase().includes(kw)) return;
      out.push({ kind: 'raw', idx, text });
    }
  });
  return out;
}
function pageCountFor(total) { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }
function serializeRowFields(fields) {
  const fs = fields.map((f) => String(f).trim());
  let last = fs.length - 1;
  while (last >= 0 && (fs[last] === '' || fs[last] === ';')) last--;
  const kept = fs.slice(0, last + 1);
  return SOURCEKIND === 'xls' ? kept.map((f) => (f === ';' ? '' : f)).join('\t') : kept.join(' ');
}
function commentItem(idx) {
  const it = MODEL.items[idx];
  if (!it || it.type !== 'row') return;
  pushUndo();
  MODEL.items[idx] = { type: 'raw', text: '// ' + serializeRowFields(it.row.fields) };
  selected = -1;
  markDirty(); renderTable();
}
function uncommentItem(idx) {
  const it = MODEL.items[idx];
  if (!it || it.type !== 'raw') return;
  const text = String(it.text).replace(/^\\s*\\/\\/+\\s?/, '').trim();
  if (!text) return;
  pushUndo();
  const fields = SOURCEKIND === 'xls' ? text.split('\t').map((s) => s.trim()) : text.split(/\\s+/);
  MODEL.items[idx] = { type: 'row', row: { fields } };
  selected = -1;
  markDirty(); renderTable();
}
function hideContextMenu() { $('ctxMenu').style.display = 'none'; }
function showContextMenu(ev, entry) {
  ev.preventDefault(); ev.stopPropagation();
  selected = entry.idx;
  const menu = $('ctxMenu');
  menu.innerHTML = '';
  const add = (label, fn) => {
    const d = document.createElement('div');
    d.className = 'ctx-item'; d.textContent = label;
    d.onclick = () => { hideContextMenu(); fn(); };
    menu.appendChild(d);
  };
  if (undoStack.length || redoStack.length) {
    if (undoStack.length) add('撤销 (Ctrl+Z)', undoEdit);
    if (redoStack.length) add('重做 (Ctrl+Shift+Z)', redoEdit);
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);
  }
  if (entry.kind === 'row') add('注释该行', () => commentItem(entry.idx));
  else if (/^\\s*\\/\\//.test(String(entry.text))) add('取消注释', () => uncommentItem(entry.idx));
  if (!menu.children.length) { menu.style.display = 'none'; return; }
  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(ev.clientX, window.innerWidth - rect.width - 6)) + 'px';
  menu.style.top = Math.max(4, Math.min(ev.clientY, window.innerHeight - rect.height - 6)) + 'px';
}
document.addEventListener('pointerdown', (ev) => {
  if ($('ctxMenu').style.display === 'block' && !ev.target.closest('#ctxMenu')) hideContextMenu();
}, true);
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
    ev.preventDefault();
    commitActiveEditor();
    $('toast').textContent = '保存中…'; $('toast').className = 'toast';
    vscode.postMessage({ type: 'save', model: MODEL });
    return;
  }
  if (ev.key === 'Escape') {
    hideContextMenu();
    if (cellSel) { cellSel = null; renderTable(); }
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) {
    ev.preventDefault();
    commitActiveEditor();
    undoEdit();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ((ev.key === 'y' || ev.key === 'Y') || (ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')))) {
    ev.preventDefault();
    commitActiveEditor();
    redoEdit();
    return;
  }
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'c' || ev.key === 'C')) { ev.preventDefault(); copySelection(); }
  else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); pasteIntoSelection(); }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key === '/') {
    ev.preventDefault();
    const it = selected >= 0 ? MODEL.items[selected] : undefined;
    if (!it) return;
    if (it.type === 'row') commentItem(selected);
    else if (/^\\s*\\/\\//.test(String(it.text))) uncommentItem(selected);
  }
});
let activeEditorTd = null;
function commitActiveEditor() {
  const td = activeEditorTd;
  activeEditorTd = null;
  if (!td) return;
  const inp = td.querySelector('input');
  if (inp && inp.onblur) inp.onblur(new Event('blur'));
}
/** 双击进入单元格编辑：失焦/Enter 提交，Esc 取消，Enter 提交后跳到下一行同列继续编辑 */
function beginEdit(td) {
  if (!td || td.classList.contains('cell-edit')) return;
  commitActiveEditor();
  const idx = parseInt(td.dataset.idx, 10);
  const col = parseInt(td.dataset.col, 10);
  const it = MODEL.items[idx];
  if (!it || it.type !== 'row') return;
  const r = it.row;
  const tr = td.closest('tr');
  selected = idx;
  const oldValue = col === 0 ? mapIdOf(r) : field(r, col);
  td.classList.remove('cell-view'); td.classList.add('cell-edit');
  td.textContent = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = oldValue;
  if (COLUMNS[col].hint) { inp.placeholder = COLUMNS[col].hint; inp.title = COLUMNS[col].hint; }
  if (col === 0) inp.title = mapName(mapIdOf(r)) || '地图号';
  if (![0, 3, 9, 14].includes(col)) inp.style.textAlign = 'center';
  typingUndoArmed = true;
  let armed = true;
  inp.oninput = () => {
    if (armed) { pushUndo(); armed = false; }
    if (!manualColumnWidths[col]) {
      const needed = Math.ceil(Math.max(64, Math.min(360, measureText(inp.value) + 22)));
      if (needed > columnWidths[col]) setColumnWidth(col, needed);
    }
  };
  const finish = (commit) => {
    if (!td.contains(inp)) return;
    if (td === activeEditorTd) activeEditorTd = null;
    let changed = false;
    if (commit && inp.value !== oldValue) {
      if (col === 0) setField(r, 0, (isSmart(r) ? '*' : '') + inp.value.trim());
      else setField(r, col, inp.value);
      markDirty();
      changed = true;
    }
    td.classList.remove('cell-edit'); td.classList.add('cell-view');
    td.textContent = '';
    const span = document.createElement('span');
    span.textContent = col === 0 ? mapIdOf(r) : field(r, col);
    td.appendChild(span);
    if (changed && (col === 0 || col === 3)) refreshMapFilter();
    return changed;
  };
  inp.onblur = () => { finish(true); };
  inp.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(true);
      let ntr = tr.nextElementSibling;
      while (ntr && ntr.classList.contains('raw-row')) ntr = ntr.nextElementSibling;
      if (ntr) {
        const ntd = ntr.querySelector('td.cell-view[data-col="' + col + '"]');
        if (ntd) beginEdit(ntd);
      } else if (page < pageCountFor(visibleEntries().length)) {
        page++;
        renderTable();
        const first = document.querySelector('td.cell-view[data-col="' + col + '"]');
        if (first) beginEdit(first);
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    }
  };
  td.appendChild(inp);
  activeEditorTd = td;
  inp.focus();
  inp.select();
}
function renderTable() {
  commitActiveEditor();
  refreshMapFilter();
  ensureColumnWidths();
  const visible = visibleEntries();
  const pages = pageCountFor(visible.length);
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  const slice = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const wrap = $('tableWrap');
  wrap.innerHTML = '';
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  const colWidths = [45, 50].concat(columnWidths).concat([48]);
  colWidths.forEach((width, index) => {
    const col = document.createElement('col'); col.style.width = width + 'px';
    if (index >= 2 && index < columnWidths.length + 2) col.dataset.column = String(index - 2);
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);
  // 固定布局必须显式给出表格总宽，col 宽度才有分配基准（auto 宽表格在滚动容器内会被 Chromium 按内容均分）
  table.style.width = colWidths.reduce((a, b) => a + b, 0) + 'px';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const noTh = document.createElement('th'); noTh.className = 'row-no'; noTh.textContent = '#';
  noTh.title = '点击全选本页单元格';
  noTh.onclick = () => {
    const rowsIdx = slice.filter((e) => e.kind === 'row').map((e) => e.idx);
    if (rowsIdx.length) {
      const allSel = cellSelRange() && cellSelRange().from === 0 && cellSelRange().to === rowsIdx.length - 1
        && cellSelRange().c1 === 0 && cellSelRange().c2 === COLUMNS.length - 1;
      cellSel = allSel ? null : { aIdx: rowsIdx[0], aCol: 0, bIdx: rowsIdx[rowsIdx.length - 1], bCol: COLUMNS.length - 1 };
      renderTable();
    }
  };
  headRow.appendChild(noTh);
  const smartTh = document.createElement('th'); smartTh.className = 'op-col'; smartTh.textContent = '智能';
  smartTh.title = '智能刷怪（保存时在地图号前加 *）'; headRow.appendChild(smartTh);
  COLUMNS.forEach((col, i) => {
    const th = document.createElement('th');
    if (col.hint) th.title = col.hint;
    addColumnResize(th, i);
    headRow.appendChild(th);
  });
  const opTh = document.createElement('th'); opTh.className = 'op-col'; opTh.textContent = '操作'; headRow.appendChild(opTh);
  thead.appendChild(headRow); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const cellRange = cellSelRange();
  for (const entry of slice) {
    if (entry.kind === 'raw') {
      const tr = document.createElement('tr');
      tr.className = 'raw-row';
      const noTd = document.createElement('td'); noTd.className = 'row-no'; noTd.textContent = '//'; noTd.title = '注释行（右键可取消注释）';
      const cell = document.createElement('td'); cell.className = 'raw-cell'; cell.colSpan = COLUMNS.length + 2;
      cell.textContent = entry.text.trim();
      tr.appendChild(noTd); tr.appendChild(cell);
      tr.addEventListener('contextmenu', (ev) => showContextMenu(ev, entry));
      tbody.appendChild(tr);
      continue;
    }
    const { idx, no, r } = entry;
    const tr = document.createElement('tr');
    tr.dataset.idx = String(idx);
    if (idx === selected) tr.classList.add('selected');
    const noTd = document.createElement('td'); noTd.className = 'row-no'; noTd.textContent = String(no);
    tr.appendChild(noTd);
    const smartTd = document.createElement('td'); smartTd.className = 'smart-cell';
    const smart = document.createElement('input'); smart.type = 'checkbox'; smart.checked = isSmart(r);
    smart.title = '智能刷怪（保存时在地图号前加 *）';
    smart.onchange = () => {
      pushUndo();
      selected = idx;
      setField(r, 0, (smart.checked ? '*' : '') + mapIdOf(r));
      markDirty();
      if (smartOnly) renderTable();
    };
    smartTd.appendChild(smart); tr.appendChild(smartTd);
    COLUMNS.forEach((col, i) => {
      const td = document.createElement('td');
      td.className = 'cell-view';
      td.dataset.idx = String(idx);
      td.dataset.col = String(i);
      if (cellRange && no - 1 >= cellRange.from && no - 1 <= cellRange.to && i >= cellRange.c1 && i <= cellRange.c2) {
        td.classList.add('cell-selected');
      }
      if (col.hint) td.title = col.hint;
      if (i === 0) td.title = mapName(mapIdOf(r)) || '地图号';
      if (![0, 3, 9, 14].includes(i)) td.style.textAlign = 'center';
      const span = document.createElement('span');
      span.textContent = i === 0 ? mapIdOf(r) : field(r, i);
      td.appendChild(span);
      td.ondblclick = () => beginEdit(td);
      tr.appendChild(td);
    });
    const opTd = document.createElement('td'); opTd.className = 'op-cell';
    const del = document.createElement('button'); del.className = 'del-row'; del.textContent = '×'; del.title = '删除此记录';
    del.onclick = () => {
      pushUndo();
      MODEL.items.splice(idx, 1);
      if (selected === idx) selected = -1; else if (selected > idx) selected--;
      markDirty(); renderTable();
    };
    opTd.appendChild(del); tr.appendChild(opTd);
    tr.addEventListener('contextmenu', (ev) => showContextMenu(ev, entry));
    attachRowSelect(tr, idx);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody); wrap.appendChild(table);
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = rows().length ? '没有符合筛选条件的记录' : '暂无刷怪记录，点击右上角「新增刷怪」开始';
    wrap.appendChild(empty);
  }
  $('rowCount').textContent = visible.filter((e) => e.kind === 'row').length + ' / ' + rows().length + ' 条记录';
  $('pageInfo').textContent = page + '/' + pages + ' 页';
  $('prevPage').disabled = page <= 1;
  $('nextPage').disabled = page >= pages;
}

$('searchInput').oninput = (ev) => { filter = ev.target.value; page = 1; renderTable(); };
$('mapFilter').onchange = () => { page = 1; renderTable(); };
$('smartFilter').onclick = () => {
  smartOnly = !smartOnly; $('smartFilter').classList.toggle('on', smartOnly); page = 1; renderTable();
};
$('prevPage').onclick = () => { if (page > 1) { page--; renderTable(); } };
$('nextPage').onclick = () => { if (page < pageCountFor(visibleEntries().length)) { page++; renderTable(); } };
$('addRowBtn').onclick = () => {
  const fields = [];
  if (selected >= 0 && MODEL.items[selected] && MODEL.items[selected].type === 'row') fields[0] = field(MODEL.items[selected].row, 0);
  const item = { type: 'row', row: { fields } };
  const at = selected >= 0 && MODEL.items[selected] ? selected + 1 : MODEL.items.length;
  pushUndo();
  MODEL.items.splice(at, 0, item); selected = at;
  markDirty();
  const pos = visibleEntries().findIndex((v) => v.idx === at);
  if (pos >= 0) page = pageCountFor(pos + 1);
  renderTable();
  requestAnimationFrame(() => {
    const inp = document.querySelector('input[data-idx="' + selected + '"][data-col="3"]');
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); }
  });
};
$('saveBtn').onclick = () => {
  $('toast').textContent = '保存中…'; $('toast').className = 'toast';
  vscode.postMessage({ type: 'save', model: MODEL });
};
$('refreshBtn').onclick = () => vscode.postMessage({ type: 'refresh' });
$('alignBtn').onclick = () => {
  pushUndo();
  for (const it of MODEL.items) if (it.type === 'row') it.row.fields = it.row.fields.map((f) => String(f).trim());
  $('alignNotice').style.display = 'none'; markDirty(); renderTable();
  $('toast').textContent = '已对齐，保存后生效'; $('toast').className = 'toast ok';
};
$('alignDismiss').onclick = () => { $('alignNotice').style.display = 'none'; };

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    MODEL = msg.model; COLUMNS = msg.columns; MAPNAMES = msg.mapNames || {}; selected = -1;
    SOURCEKIND = msg.sourceKind || 'txt';
    undoStack = []; redoStack = []; page = 1;
    cellSel = null;
    clearDirty(); $('pathHint').textContent = msg.filePath; $('pathHint').title = msg.filePath;
    $('sourceBadge').textContent = msg.sourceKind === 'xls' ? 'XLS' : 'TXT';
    $('sourceBadge').classList.toggle('xls', msg.sourceKind === 'xls');
    $('sourceHint').textContent = msg.sourceKind === 'xls' ? '正在读写 Data/mongen.xls（优先于 TXT）' : '未检测到 Data/mongen.xls，正在读写 MonGen.txt';
    $('alignNotice').style.display = msg.messy ? 'flex' : 'none';
    $('loadErrorNotice').style.display = msg.loadError ? 'flex' : 'none';
    $('loadErrorText').textContent = msg.loadError || '';
    $('saveBtn').disabled = Boolean(msg.loadError); $('addRowBtn').disabled = Boolean(msg.loadError);
    renderTable();
  } else if (msg.type === 'saveResult') {
    if (msg.ok) { clearDirty(); $('toast').textContent = '已保存'; $('toast').className = 'toast ok'; }
    else { $('toast').textContent = '保存失败：' + msg.error; $('toast').className = 'toast err'; }
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
