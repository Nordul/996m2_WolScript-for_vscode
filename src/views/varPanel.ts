import * as vscode from 'vscode';
import { VarScanner, ScanResult } from '../scanner/varScanner';
import { varTypes } from '../providers/data';

export class VarPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly scanner: VarScanner) {
    scanner.onDidScan((r) => this.pushData(r));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          this.pushData(this.scanner.getResult());
          break;
        case 'refresh':
          await this.scanner.scanWorkspace();
          break;
        case 'reveal': {
          const uri = vscode.Uri.file(msg.absPath);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc, { preview: true });
          const pos = new vscode.Position(Math.max(0, msg.line), 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          break;
        }
      }
    });
  }

  async refresh(): Promise<void> {
    await this.scanner.scanWorkspace();
  }

  private pushData(result: ScanResult): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'data', result, varTypes });
  }

  private renderHtml(webview: vscode.Webview): string {
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
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 10px;
  }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .search {
    flex: 1; display: flex; align-items: center; gap: 6px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 6px; padding: 4px 8px;
  }
  .search input {
    flex: 1; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground); font-size: 12px;
  }
  .icon-btn {
    border: none; background: transparent; cursor: pointer; border-radius: 6px;
    color: var(--vscode-foreground); padding: 4px 6px; font-size: 13px;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .stats { font-size: 11px; opacity: .65; margin-bottom: 8px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .tab {
    padding: 2px 8px; font-size: 11px; border-radius: 10px; cursor: pointer;
    background: var(--vscode-badge-background, var(--vscode-button-secondaryBackground));
    color: var(--vscode-badge-foreground, var(--vscode-button-secondaryForeground));
    opacity: .75; user-select: none;
  }
  .tab:hover { opacity: 1; }
  .tab.active { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
  .tab .n { opacity: .7; }
  .group { margin-bottom: 12px; }
  .group-title {
    font-size: 11px; font-weight: 600; letter-spacing: .5px; opacity: .6;
    margin-bottom: 5px; display: flex; justify-content: space-between;
  }
  .var-card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
    border-radius: 8px; margin-bottom: 4px; overflow: hidden;
  }
  .var-head {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    cursor: pointer; user-select: none;
  }
  .var-head:hover { background: var(--vscode-list-hoverBackground); }
  .var-name { font-family: var(--vscode-editor-font-family); font-weight: 600; font-size: 12px; }
  .badge {
    font-size: 10px; padding: 0 5px; border-radius: 8px; line-height: 15px;
  }
  .badge.w { background: rgba(220, 120, 60, .18); color: var(--vscode-charts-orange, #e8912d); }
  .badge.r { background: rgba(60, 140, 220, .15); color: var(--vscode-charts-blue, #4ea1f3); }
  .refs { display: none; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
  .var-card.open .refs { display: block; }
  .ref {
    display: flex; gap: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer;
    align-items: baseline;
  }
  .ref:hover { background: var(--vscode-list-hoverBackground); }
  .ref .loc { white-space: nowrap; opacity: .75; font-family: var(--vscode-editor-font-family); }
  .ref .ctx { opacity: .45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .ref .acc { font-size: 10px; width: 12px; text-align: center; }
  .empty { text-align: center; opacity: .5; padding: 40px 0; font-size: 12px; }
  .count { margin-left: auto; font-size: 10px; opacity: .55; }
  .arrow { font-size: 9px; opacity: .5; transition: transform .15s; }
  .var-card.open .arrow { transform: rotate(90deg); }
</style>
</head>
<body>
  <div class="header">
    <div class="search">
      <span style="opacity:.5">⌕</span>
      <input id="q" type="text" placeholder="搜索变量, 如 S0 / A15">
    </div>
    <button class="icon-btn" id="refresh" title="重新扫描">⟳</button>
  </div>
  <div class="stats" id="stats">尚未扫描</div>
  <div class="tabs" id="tabs"></div>
  <div id="list"></div>
  <div class="empty" id="empty" style="display:none">未发现已占用变量<br><span style="font-size:11px">打开或保存脚本文件后自动扫描</span></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let state = { result: null, varTypes: [], tab: 'ALL', q: '' };

  const tabsEl = document.getElementById('tabs');
  const listEl = document.getElementById('list');
  const statsEl = document.getElementById('stats');
  const emptyEl = document.getElementById('empty');

  document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toUpperCase(); render(); });
  document.getElementById('refresh').addEventListener('click', () => {
    statsEl.textContent = '扫描中...';
    vscode.postMessage({ type: 'refresh' });
  });

  window.addEventListener('message', (e) => {
    if (e.data.type === 'data') { state.result = e.data.result; state.varTypes = e.data.varTypes; render(); }
  });

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function typeLabel(prefix) {
    const t = state.varTypes.find(v => v.prefix === prefix);
    return t ? t.desc : '';
  }

  function render() {
    const r = state.result;
    if (!r || !r.groups) { statsEl.textContent = '尚未扫描'; return; }
    const groups = r.groups;
    const groupNames = Object.keys(groups).sort((a, b) => {
      const order = state.varTypes.map(v => v.prefix);
      return order.indexOf(a) - order.indexOf(b);
    });
    let totalVars = 0;
    for (const g of groupNames) totalVars += Object.keys(groups[g]).length;
    statsEl.textContent = '已扫描 ' + r.fileCount + ' 个脚本文件 · 占用 ' + totalVars + ' 个变量 · ' + fmtTime(r.scannedAt);

    // tabs
    const tabDefs = [{ p: 'ALL', label: '全部' }].concat(
      state.varTypes.filter(t => groups[t.prefix]).map(t => {
        const max = t.prefix === 'MARK' ? 800 : (t.max > 0 ? t.max + 1 : 0);
        return { p: t.prefix, label: t.prefix === 'MARK' ? '标记' : (t.prefix === 'CUSTOM' ? '自定义' : t.prefix), max };
      })
    );
    tabsEl.innerHTML = '';
    for (const t of tabDefs) {
      const el = document.createElement('span');
      el.className = 'tab' + (state.tab === t.p ? ' active' : '');
      const n = t.p === 'ALL' ? totalVars : Object.keys(groups[t.p] || {}).length;
      el.innerHTML = t.label + ' <span class="n">' + n + (t.max ? '/' + t.max : '') + '</span>';
      el.onclick = () => { state.tab = t.p; render(); };
      tabsEl.appendChild(el);
    }

    // list
    listEl.innerHTML = '';
    let shown = 0;
    const showGroups = state.tab === 'ALL' ? groupNames : groupNames.filter(g => g === state.tab);
    for (const g of showGroups) {
      const vars = groups[g];
      const names = Object.keys(vars).filter(n => !state.q || n.toUpperCase().includes(state.q));
      if (!names.length) continue;
      const gEl = document.createElement('div');
      gEl.className = 'group';
      const vt = state.varTypes.find(v => v.prefix === g);
      const totalHint = vt && vt.max > 0 ? '空闲 ' + Math.max(0, vt.max - vt.min + 1 - Object.keys(vars).length) : '';
      gEl.innerHTML = '<div class="group-title"><span>' + g + ' 变量' + (vt ? ' · ' + vt.valueType + ' · ' + vt.scope : '') + '</span><span>' + totalHint + '</span></div>';
      for (const name of names) {
        const refs = vars[name];
        const w = refs.filter(x => x.access === 'write').length;
        const rd = refs.length - w;
        const card = document.createElement('div');
        card.className = 'var-card';
        const head = document.createElement('div');
        head.className = 'var-head';
        head.innerHTML =
          '<span class="arrow">▶</span>' +
          '<span class="var-name">' + name + '</span>' +
          (w ? '<span class="badge w">写 ' + w + '</span>' : '') +
          (rd ? '<span class="badge r">读 ' + rd + '</span>' : '') +
          '<span class="count">' + refs.length + ' 处</span>';
        head.onclick = () => card.classList.toggle('open');
        const refsEl = document.createElement('div');
        refsEl.className = 'refs';
        for (const ref of refs.slice(0, 60)) {
          const rEl = document.createElement('div');
          rEl.className = 'ref';
          rEl.innerHTML =
            '<span class="acc">' + (ref.access === 'write' ? '✎' : '·') + '</span>' +
            '<span class="loc">' + ref.file + ':' + (ref.line + 1) + '</span>' +
            '<span class="ctx">' + escapeHtml(ref.context) + '</span>';
          rEl.onclick = () => vscode.postMessage({ type: 'reveal', absPath: ref.absPath, line: ref.line });
          refsEl.appendChild(rEl);
        }
        if (refs.length > 60) {
          const more = document.createElement('div');
          more.className = 'ref';
          more.innerHTML = '<span class="ctx">... 共 ' + refs.length + ' 处, 仅显示前 60</span>';
          refsEl.appendChild(more);
        }
        card.appendChild(head);
        card.appendChild(refsEl);
        gEl.appendChild(card);
        shown++;
      }
      if (names.length) listEl.appendChild(gEl);
    }
    emptyEl.style.display = shown ? 'none' : 'block';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
