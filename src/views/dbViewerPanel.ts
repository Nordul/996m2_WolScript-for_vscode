import * as vscode from 'vscode';
import * as path from 'path';
import { loadGameLoadDb, invalidateGameLoadDb } from '../db/gameLoadDb';
import * as q from '../db/dbQueries';

const PAGE_SIZE = 200;

interface WebviewMsg {
  type: string;
  table?: string;
  offset?: number;
  filter?: string;
}

/** GameLoad.DB 数据库查看器 (单例面板: 左侧表列表 + 右侧分页数据网格) */
export class DbViewerPanel {
  private static current: DbViewerPanel | undefined;

  static show(context: vscode.ExtensionContext): void {
    if (DbViewerPanel.current) {
      DbViewerPanel.current.panel.reveal();
      void DbViewerPanel.current.reload();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.dbViewer',
      '数据库查看器 (GameLoad.DB)',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    DbViewerPanel.current = new DbViewerPanel(context, panel);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
  ) {
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => { DbViewerPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg: WebviewMsg) => void this.onMessage(msg), null, context.subscriptions);
    panel.webview.html = this.renderHtml();
  }

  /** 重新定位并打开 DB, 把结果 (表清单或缺失提示) 发给 webview */
  private async reload(): Promise<void> {
    invalidateGameLoadDb();
    const db = await loadGameLoadDb(this.context);
    if (!db) {
      this.panel.webview.postMessage({ type: 'missing' });
      return;
    }
    try {
      const tables = q.listTables(db);
      this.panel.webview.postMessage({ type: 'tables', tables });
    } catch (e) {
      this.panel.webview.postMessage({ type: 'missing', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async sendPage(table: string, offset: number, filter: string): Promise<void> {
    const db = await loadGameLoadDb(this.context);
    if (!db) {
      this.panel.webview.postMessage({ type: 'missing' });
      return;
    }
    try {
      const { rows, total, columns } = q.getRows(db, table, offset, PAGE_SIZE, filter || undefined);
      this.panel.webview.postMessage({ type: 'data', table, columns, rows, total, offset, filter });
    } catch (e) {
      this.panel.webview.postMessage({
        type: 'data', table, columns: [], rows: [], total: 0, offset, filter,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async onMessage(msg: WebviewMsg): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.reload();
        break;
      case 'select':
        if (msg.table) await this.sendPage(msg.table, 0, '');
        break;
      case 'page':
        if (msg.table) await this.sendPage(msg.table, msg.offset ?? 0, msg.filter ?? '');
        break;
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
  .toolbar .sub { font-size: 11px; opacity: .5; }
  .toolbar .spacer { flex: 1; }
  .btn {
    border: none; border-radius: 6px; cursor: pointer; font-size: 12px; padding: 5px 14px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .body { flex: 1; display: flex; overflow: hidden; }
  .sidebar {
    width: 240px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .sidebar .search { padding: 10px 10px 6px; }
  .sidebar input[type=text] {
    width: 100%; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .sidebar input[type=text]:focus { border-color: var(--vscode-focusBorder); }
  .tlist { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
  .trow {
    display: flex; align-items: baseline; gap: 6px; padding: 4px 8px; border-radius: 6px;
    cursor: pointer; font-size: 12px;
  }
  .trow:hover { background: var(--vscode-list-hoverBackground); }
  .trow.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .trow .tname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
  .trow .tcount { margin-left: auto; font-size: 10px; opacity: .5; font-family: var(--vscode-editor-font-family); }
  .splitter { width: 5px; cursor: col-resize; flex-shrink: 0; }
  .splitter:hover, .splitter.active { background: var(--vscode-focusBorder); opacity: .5; }
  .main { flex: 1; overflow: hidden; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
  .thead-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-shrink: 0; flex-wrap: wrap; }
  .thead-bar .tname2 { font-size: 14px; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .thead-bar .tmeta { font-size: 11px; opacity: .5; }
  .thead-bar input[type=text] {
    width: 220px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none; margin-left: auto;
  }
  .thead-bar input[type=text]:focus { border-color: var(--vscode-focusBorder); }
  .grid-wrap { flex: 1; overflow: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); border-radius: 6px; }
  table.grid { border-collapse: collapse; min-width: 100%; }
  .grid th {
    font-size: 11px; opacity: .6; text-align: left; padding: 5px 10px; font-weight: 600; white-space: nowrap;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
    position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 1;
  }
  .grid td {
    padding: 4px 10px; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.08));
    white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family);
  }
  .pager { display: flex; align-items: center; gap: 10px; padding-top: 10px; flex-shrink: 0; }
  .pager .pinfo { font-size: 12px; opacity: .7; }
  .empty-hint { opacity: .45; text-align: center; margin-top: 80px; font-size: 13px; line-height: 2; }
  .guide { max-width: 560px; margin: 60px auto; padding: 18px 22px; font-size: 13px; line-height: 2;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); border-radius: 8px; }
  .guide h2 { font-size: 14px; margin-bottom: 8px; }
  .guide code { font-family: var(--vscode-editor-font-family); background: rgba(128,128,128,.15); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .err { color: var(--vscode-errorForeground, #f66); font-size: 12px; }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="title">数据库查看器</span>
    <span class="sub">GameLoad.DB</span>
    <span class="spacer"></span>
    <button class="btn secondary" id="refreshBtn" title="重新定位 GameLoad.DB">刷新</button>
  </div>
  <div class="body" id="body">
    <div class="sidebar" id="side">
      <div class="search"><input type="text" id="sideSearch" placeholder="搜索数据表…"></div>
      <div class="tlist" id="tlist"></div>
    </div>
    <div class="splitter" id="split1"></div>
    <div class="main" id="main"><div class="empty-hint">正在加载数据库…</div></div>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const PAGE = ${PAGE_SIZE};

let tables = [];        // [{name, count}]
let current = '';       // 当前表名
let offset = 0;         // 当前页偏移
let filter = '';        // 当前过滤词
let loading = false;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cellText(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

// ---- 可拖拽分栏 (宽度持久化到 setState) ----
function makeResizable(splitterId, targetId, stateKey, defWidth, minW, maxW) {
  const sp = $(splitterId), target = $(targetId);
  if (!sp || !target) return;
  const saved = (vscode.getState() || {})[stateKey];
  target.style.width = (saved || defWidth) + 'px';
  sp.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sp.classList.add('active');
    const startX = e.clientX;
    const startW = target.getBoundingClientRect().width;
    const onMove = (ev) => {
      const w = Math.max(minW, Math.min(maxW, startW + ev.clientX - startX));
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
makeResizable('split1', 'side', 'dbSideW', 240, 150, 500);

function renderTableList() {
  const kw = $('sideSearch').value.trim().toLowerCase();
  const list = kw ? tables.filter((t) => t.name.toLowerCase().includes(kw)) : tables;
  const el = $('tlist');
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div style="opacity:.45;font-size:12px;padding:8px">' + (tables.length ? '没有匹配的表' : '未找到数据表') + '</div>';
    return;
  }
  for (const t of list) {
    const row = document.createElement('div');
    row.className = 'trow' + (t.name === current ? ' selected' : '');
    row.innerHTML = '<span class="tname"></span><span class="tcount">' + t.count + '</span>';
    row.querySelector('.tname').textContent = t.name;
    row.title = t.name;
    row.onclick = () => {
      if (t.name === current || loading) return;
      current = t.name; offset = 0; filter = '';
      renderTableList();
      renderMain('<div class="empty-hint">加载中…</div>');
      vscode.postMessage({ type: 'select', table: t.name });
    };
    el.appendChild(row);
  }
}

function renderMain(html) { $('main').innerHTML = html; }

function renderData(msg) {
  offset = msg.offset;
  filter = msg.filter || '';
  const pages = Math.max(1, Math.ceil(msg.total / PAGE));
  const page = Math.min(pages, Math.floor(msg.offset / PAGE) + 1);
  let html = '<div class="thead-bar">'
    + '<span class="tname2">' + esc(msg.table) + '</span>'
    + '<span class="tmeta">共 ' + msg.total + ' 行</span>'
    + '<input type="text" id="filterInput" placeholder="按文本列过滤…" value="' + esc(filter) + '"></div>';
  if (msg.error) {
    html += '<div class="err">查询失败：' + esc(msg.error) + '</div>';
    renderMain(html);
    bindFilter(msg.table);
    return;
  }
  html += '<div class="grid-wrap"><table class="grid"><thead><tr>';
  for (const c of msg.columns) html += '<th>' + esc(c) + '</th>';
  html += '</tr></thead><tbody>';
  for (const row of msg.rows) {
    html += '<tr>';
    for (const c of msg.columns) {
      const s = cellText(row[c]);
      html += '<td title="' + esc(s) + '">' + esc(s) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += '<div class="pager">'
    + '<button class="btn secondary" id="prevBtn"' + (page <= 1 ? ' disabled' : '') + '>‹ 上一页</button>'
    + '<span class="pinfo">第 ' + page + ' / ' + pages + ' 页</span>'
    + '<button class="btn secondary" id="nextBtn"' + (page >= pages ? ' disabled' : '') + '>下一页 ›</button>'
    + '<span class="pinfo">' + msg.rows.length + ' 行 / 页</span></div>';
  renderMain(html);
  $('prevBtn').onclick = () => {
    if (loading) return;
    loading = true;
    vscode.postMessage({ type: 'page', table: msg.table, offset: Math.max(0, offset - PAGE), filter });
  };
  $('nextBtn').onclick = () => {
    if (loading) return;
    loading = true;
    vscode.postMessage({ type: 'page', table: msg.table, offset: offset + PAGE, filter });
  };
  bindFilter(msg.table);
}

function bindFilter(table) {
  const inp = $('filterInput');
  if (!inp) return;
  let timer = null;
  inp.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (loading) return;
      loading = true;
      vscode.postMessage({ type: 'page', table, offset: 0, filter: inp.value.trim() });
    }, 300);
  };
}

function renderMissing() {
  current = '';
  renderTableList();
  renderMain('<div class="guide"><h2>未找到 GameLoad.DB</h2>'
    + '数据库查看器需要服务端数据库文件 <code>GameLoad.DB</code>（SQLite 格式）。<br>'
    + '请将该文件放入工作区的 <code>DB</code> 目录下（例如 <code>Envir\\DB\\GameLoad.DB</code>），然后点击右上角「刷新」。<br>'
    + '打开后可在左侧浏览全部数据表，右侧分页查看物品、怪物、技能等数据。</div>');
}

$('sideSearch').oninput = renderTableList;
$('refreshBtn').onclick = () => {
  if (loading) return;
  loading = true;
  renderMain('<div class="empty-hint">正在加载数据库…</div>');
  vscode.postMessage({ type: 'refresh' });
};

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'tables') {
    loading = false;
    tables = msg.tables;
    renderTableList();
    renderMain('<div class="empty-hint">在左侧选择一个数据表</div>');
  } else if (msg.type === 'missing') {
    loading = false;
    renderMissing();
  } else if (msg.type === 'data') {
    loading = false;
    renderData(msg);
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
