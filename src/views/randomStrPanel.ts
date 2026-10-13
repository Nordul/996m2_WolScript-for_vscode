import * as vscode from 'vscode';
import * as path from 'path';
import { parseRandomStrList, RandomStrItem } from '../providers/randomStrLens';

/** RandomStr 权重模拟面板 (单例, 再次点击更新内容) */
export class RandomStrPanel {
  private static current: RandomStrPanel | undefined;

  static show(context: vscode.ExtensionContext, listRaw: string): void {
    const items = parseRandomStrList(listRaw);
    if (!items.length) {
      void vscode.window.showWarningMessage('未能解析 RandomStr 权重列表');
      return;
    }
    if (RandomStrPanel.current) {
      RandomStrPanel.current.panel.reveal();
      RandomStrPanel.current.update(items);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.randomStr', 'RandomStr 权重模拟', vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    RandomStrPanel.current = new RandomStrPanel(context, panel, items);
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    items: RandomStrItem[],
  ) {
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => { RandomStrPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') this.update(items);
    }, null, context.subscriptions);
    panel.webview.html = this.renderHtml();
  }

  private update(items: RandomStrItem[]): void {
    this.panel.webview.postMessage({ type: 'items', items });
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
    padding: 16px 20px;
  }
  h1 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
  .warn {
    display: none; margin-bottom: 10px; padding: 6px 10px; border-radius: 6px; font-size: 12px;
    background: rgba(220,160,60,.12); color: var(--vscode-charts-orange, #e8a12d);
  }
  table { width: 100%; max-width: 720px; border-collapse: collapse; margin-bottom: 14px; }
  th, td { padding: 5px 10px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); }
  th { font-size: 11px; opacity: .6; font-weight: 600; }
  td.num, th.num { text-align: right; font-family: var(--vscode-editor-font-family); }
  td.name { font-family: var(--vscode-editor-font-family); }
  td .wraw { font-size: 10px; opacity: .45; display: block; }
  input.wedit {
    width: 80px; padding: 2px 6px; border-radius: 5px; font-size: 12px; text-align: right;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35)); outline: none;
    font-family: var(--vscode-editor-font-family);
  }
  input.wedit:focus { border-color: var(--vscode-focusBorder); }
  .bar { height: 4px; border-radius: 2px; background: var(--vscode-progressBar-background, #0e70c0); margin-top: 3px; }
  .controls { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .controls label { font-size: 12px; opacity: .8; }
  input[type=number] {
    width: 110px; padding: 4px 8px; border-radius: 6px; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); outline: none;
  }
  button {
    padding: 4px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .sim-info { font-size: 11px; opacity: .6; margin-left: 6px; }
  td.hit { color: var(--vscode-charts-green, #4ec9b0); }
</style>
</head>
<body>
  <h1>RandomStr 权重模拟</h1>
  <div class="warn" id="warn">权重中包含变量或缺失值，可在权重列手动填入数值参与计算；未填的项按 0 处理</div>
  <table>
    <thead><tr><th>项目</th><th class="num">权重</th><th class="num">理论概率</th><th class="num" id="hitHead" style="display:none">模拟命中</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="controls">
    <label>模拟轮数</label>
    <input type="number" id="rounds" value="10000" min="1" max="100000000">
    <button id="run">开始模拟</button>
    <span class="sim-info" id="simInfo"></span>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let items = [];

  const rowsEl = document.getElementById('rows');
  const warnEl = document.getElementById('warn');
  const hitHead = document.getElementById('hitHead');
  const runBtn = document.getElementById('run');
  const simInfo = document.getElementById('simInfo');

  function effWeight(it) {
    if (it.weight !== undefined) return it.weight;
    const m = parseFloat(it.manualWeight);
    return isNaN(m) || m < 0 ? 0 : m;
  }

  function totalWeight() { return items.reduce((s, it) => s + effWeight(it), 0); }

  function render(hits) {
    warnEl.style.display = items.some(it => it.weight === undefined && (it.manualWeight === undefined || isNaN(parseFloat(it.manualWeight)))) ? 'block' : 'none';
    const total = totalWeight();
    const rounds = hits ? hits.reduce((s, h) => s + h, 0) : 0;
    hitHead.style.display = hits ? '' : 'none';
    rowsEl.innerHTML = '';
    const maxPct = Math.max.apply(null, items.map(it => total > 0 ? effWeight(it) / total : 0).concat([0.0001]));
    items.forEach((it, i) => {
      const pct = total > 0 ? effWeight(it) / total : 0;
      const tr = document.createElement('tr');
      let hitHtml = '';
      if (hits) {
        const hp = rounds > 0 ? hits[i] / rounds : 0;
        hitHtml = '<td class="num hit">' + hits[i] + ' (' + (hp * 100).toFixed(2) + '%)</td>';
      }
      let weightHtml;
      if (it.weight !== undefined) {
        weightHtml = String(it.weight);
      } else {
        weightHtml = '<input class="wedit" data-idx="' + i + '" type="number" min="0" step="any" placeholder="0" value="'
          + (it.manualWeight === undefined ? '' : escapeHtml(it.manualWeight)) + '">'
          + '<span class="wraw">' + escapeHtml(it.weightRaw || '缺权重') + '</span>';
      }
      tr.innerHTML =
        '<td class="name">' + escapeHtml(it.name) + '<div class="bar" style="width:' + (pct / maxPct * 100).toFixed(1) + '%"></div></td>' +
        '<td class="num">' + weightHtml + '</td>' +
        '<td class="num">' + (total > 0 ? (pct * 100).toFixed(2) + '%' : '-') + '</td>' +
        hitHtml;
      rowsEl.appendChild(tr);
    });
    rowsEl.querySelectorAll('input.wedit').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.dataset.idx);
        const v = inp.value.trim();
        items[idx].manualWeight = v === '' ? undefined : v;
        simInfo.textContent = '';
        render(null);
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  runBtn.addEventListener('click', () => {
    const rounds = Math.max(1, Math.min(100000000, Math.floor(Number(document.getElementById('rounds').value) || 0)));
    const total = totalWeight();
    if (total <= 0) { simInfo.textContent = '总权重为 0, 无法模拟'; return; }
    const hits = items.map(() => 0);
    const cum = [];
    let acc = 0;
    for (const it of items) { acc += effWeight(it); cum.push(acc); }
    const t0 = Date.now();
    for (let r = 0; r < rounds; r++) {
      const x = Math.random() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (x < cum[mid]) hi = mid; else lo = mid + 1; }
      hits[lo]++;
    }
    render(hits);
    simInfo.textContent = '已模拟 ' + rounds + ' 轮, 耗时 ' + (Date.now() - t0) + 'ms';
  });

  window.addEventListener('message', (e) => {
    if (e.data.type === 'items') {
      items = e.data.items;
      simInfo.textContent = '';
      render(null);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
