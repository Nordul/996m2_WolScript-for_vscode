import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { decodeScript } from '../scanner/scanCore';
import {
  MerchantModel, MERCHANT_COLUMNS, parseMerchant, serializeMerchant, merchantNeedsAlignment,
  merchantScriptCandidates,
} from './merchantModel';
import { parseMapInfo, mapInfoEntries } from './mapModel';

/** 在目录下递归搜索文件名(不含扩展名, 大小写不敏感, 忽略 . 开头目录), 返回第一个命中 */
function findScriptByName(baseDir: string, nameSegs: string[], depth = 6): string | undefined {
  const targets = new Set(nameSegs.map((s) => `${s}.txt`.toLowerCase()));
  const walk = (dir: string, d: number): string | undefined => {
    if (d < 0) return undefined;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p, d - 1);
        if (hit) return hit;
      } else if (targets.has(e.name.toLowerCase())) {
        return p;
      }
    }
    return undefined;
  };
  return walk(baseDir, depth);
}

export class MerchantPanel {
  private static current: MerchantPanel | undefined;

  static show(context: vscode.ExtensionContext, file: vscode.Uri): void {
    if (MerchantPanel.current) {
      MerchantPanel.current.panel.reveal();
      MerchantPanel.current.setFile(file);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.merchantManager',
      'NPC管理器',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MerchantPanel.current = new MerchantPanel(context, panel, file);
  }

  private fileUri!: vscode.Uri;
  private model!: MerchantModel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    file: vscode.Uri,
  ) {
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => { MerchantPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, context.subscriptions);
    panel.webview.html = this.renderHtml();
    this.setFile(file);
  }

  private setFile(file: vscode.Uri): void {
    this.fileUri = file;
    void this.load();
  }

  private async load(): Promise<void> {
    let model: MerchantModel;
    let messy = false;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      const text = decodeScript(bytes);
      model = parseMerchant(text);
      messy = merchantNeedsAlignment(text);
    } catch {
      model = { items: [] };
    }
    this.model = model;
    // 读取同目录 MapInfo.txt，用于把地图号显示为地图名称
    const mapNames: Record<string, string> = {};
    try {
      const miBytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(path.join(path.dirname(this.fileUri.fsPath), 'MapInfo.txt')),
      );
      for (const e of mapInfoEntries(parseMapInfo(decodeScript(miBytes)))) {
        mapNames[e.id.toUpperCase()] = e.name;
      }
    } catch { /* MapInfo.txt 不存在则跳过 */ }
    this.panel.title = `NPC管理器 - ${path.basename(this.fileUri.fsPath)}`;
    this.panel.webview.postMessage({
      type: 'load',
      model,
      columns: MERCHANT_COLUMNS,
      filePath: this.fileUri.fsPath,
      mapNames,
      messy,
    });
  }

  private async onMessage(msg: { type: string; model?: MerchantModel; name?: string; map?: string }): Promise<void> {
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
      case 'openScript':
        await this.openScript((msg.name || '').trim(), (msg.map || '').trim());
        break;
    }
  }

  /** 跳转到 NPC 脚本: Market_def\<文件名>-<地图号>.txt; 文件名以「同读」开头则不带地图号后缀 */
  private async openScript(name: string, mapId: string): Promise<void> {
    if (!name) {
      void vscode.window.showWarningMessage('请先填写文件名');
      return;
    }
    const base = path.join(path.dirname(this.fileUri.fsPath), 'Market_def');
    const candidates = merchantScriptCandidates(name, mapId);
    let fsPath: string | undefined;
    for (const rel of candidates) {
      const p = path.join(base, `${rel}.txt`);
      if (fs.existsSync(p)) { fsPath = p; break; }
    }
    if (!fsPath) {
      // 候选都没命中: 在 Market_def 下按文件名递归搜索(大小写不敏感)
      const segs = [...new Set(candidates.map((c) => c.split('\\').pop()!))];
      fsPath = findScriptByName(base, segs);
    }
    if (!fsPath) {
      const pick = await vscode.window.showWarningMessage(`脚本文件不存在: ${candidates[0]}.txt`, '创建脚本');
      if (pick !== '创建脚本') return;
      fsPath = path.join(base, `${candidates[0]}.txt`);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fsPath)));
      const skeleton = '[@main]\r\n#IF\r\nTrue\r\n#ACT\r\n#SAY\r\n';
      await vscode.workspace.fs.writeFile(vscode.Uri.file(fsPath), iconv.encode(skeleton, 'gbk'));
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async save(model: MerchantModel): Promise<string | undefined> {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty && doc.uri.fsPath === this.fileUri.fsPath) {
        return 'Merchant.txt 在编辑器中有未保存的改动，请先保存或还原后再试';
      }
    }
    try {
      await vscode.workspace.fs.writeFile(this.fileUri, iconv.encode(serializeMerchant(model), 'gbk'));
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
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .toolbar {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
    flex-shrink: 0;
  }
  .toolbar .title { font-weight: 600; font-size: 13px; }
  .toolbar .path { font-size: 11px; opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
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
  .btn.danger { background: transparent; color: var(--vscode-errorForeground, #f66); padding: 2px 6px; }
  .btn.danger:hover { background: rgba(255,80,80,.12); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-charts-orange, #e8912d); display: none; }
  .dirty .dot { display: inline-block; }
  .toast { font-size: 12px; padding: 0 6px; }
  .toast.ok { color: var(--vscode-charts-green, #6f6); }
  .toast.err { color: var(--vscode-errorForeground, #f66); }
  .notice {
    display: flex; align-items: center; gap: 10px; padding: 6px 14px;
    font-size: 12px; flex-shrink: 0;
    background: var(--vscode-inputValidation-warningBackground, rgba(200,150,40,.12));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .notice span { flex: 1; }

  .body { flex: 1; display: flex; overflow: hidden; }
  .sidebar {
    width: 300px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .sidebar .search { padding: 10px; }
  .sidebar input[type=text] {
    width: 100%; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .quick-filters { display: flex; gap: 4px; padding: 0 10px 8px; flex-wrap: wrap; }
  #mapFilter {
    flex: 1; min-width: 0; font-size: 11px; border-radius: 10px; padding: 1px 6px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3));
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    outline: none;
  }
  .row-list { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
  .group-head {
    font-size: 11px; font-weight: 600; opacity: .6; padding: 8px 6px 3px;
    position: sticky; top: 0; background: var(--vscode-editor-background); user-select: none;
    cursor: pointer; display: flex; align-items: center; gap: 4px;
  }
  .group-head:hover { opacity: .9; }
  .group-head .caret { font-size: 9px; width: 10px; }
  .group-head .gname2 { font-weight: 400; opacity: .8; }
  .npc-item {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px;
    cursor: pointer; user-select: none; margin-bottom: 2px; font-size: 12px;
  }
  .npc-item:hover { background: var(--vscode-list-hoverBackground); }
  .npc-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .npc-item .gname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .npc-item .ginfo { opacity: .55; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
  .npc-item .del { visibility: hidden; border: none; background: none; cursor: pointer; color: inherit; opacity: .5; font-size: 13px; padding: 0 2px; }
  .npc-item:hover .del { visibility: visible; }
  .npc-item .del:hover { opacity: 1; color: var(--vscode-errorForeground, #f66); }
  .add-bar { padding: 8px 10px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
  .splitter { width: 5px; cursor: col-resize; flex-shrink: 0; }
  .splitter:hover, .splitter.active { background: var(--vscode-focusBorder); opacity: .5; }
  .splitter.active { opacity: .8; }

  .main { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .empty-hint { opacity: .45; text-align: center; margin-top: 80px; font-size: 13px; }
  .section-title {
    font-size: 11px; font-weight: 600; letter-spacing: .5px; opacity: .55;
    margin: 16px 0 8px; display: flex; align-items: center; gap: 8px;
  }
  .section-title::after { content: ''; flex: 1; height: 1px; background: var(--vscode-panel-border, rgba(128,128,128,.2)); }
  .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px 14px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 11px; opacity: .6; }
  .field input {
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 6px 10px; font-size: 12px; outline: none; width: 100%;
  }
  .field input:focus { border-color: var(--vscode-focusBorder); }
  .field .extra-hint { font-size: 11px; opacity: .5; }
</style>
</head>
<body>
  <div class="toolbar" id="toolbar">
    <span class="title">NPC管理器</span>
    <span class="path" id="pathHint"></span>
    <span class="toast" id="toast"></span>
    <button class="btn secondary" id="refreshBtn" title="从磁盘重新加载">刷新</button>
    <button class="btn" id="saveBtn"><span class="dot"></span>保存</button>
  </div>
  <div class="notice" id="alignNotice" style="display:none">
    <span>检测到文件使用 TAB 或不规则空格，建议整理为单空格分隔</span>
    <button class="btn secondary" id="alignBtn">自动对齐</button>
    <button class="btn danger" id="alignDismiss" title="忽略">×</button>
  </div>
  <div class="body">
    <div class="sidebar" id="npcSidebar">
      <div class="search"><input type="text" id="searchInput" placeholder="搜索NPC名 / 文件名 / 地图…"></div>
      <div class="quick-filters">
        <select id="mapFilter" title="按地图筛选">
          <option value="">全部地图</option>
        </select>
      </div>
      <div class="row-list" id="rowList"></div>
      <div class="add-bar"><button class="btn secondary" id="addRowBtn" style="width:100%">＋ 新增NPC</button></div>
    </div>
    <div class="splitter" id="split1"></div>
    <div class="main" id="rowForm"></div>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ---- 可拖拽分栏 ----
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
let MODEL = { items: [] };
let COLUMNS = [];
let selected = -1;   // MODEL.items 下标
let filter = '';
let dirty = false;

const $ = (id) => document.getElementById(id);
let MAPNAMES = {};            // 地图号大写 -> 地图名称
const collapsed = new Set();  // 折叠的分组 key（地图号）

function mapName(id) { return MAPNAMES[String(id).toUpperCase()] || ''; }

function markDirty() {
  dirty = true;
  $('toolbar').classList.add('dirty');
  $('toast').textContent = '';
}
function clearDirty() { dirty = false; $('toolbar').classList.remove('dirty'); }

function field(row, i) {
  const v = row.fields[i] !== undefined ? row.fields[i] : '';
  return v === ';' ? '' : v;   // ; 是引擎的空列占位符，显示为空
}
function mapIdOf(r) { return field(r, 1); }
function setField(row, i, v) {
  while (row.fields.length < i) row.fields.push('');
  row.fields[i] = v;
}

function rows() {
  const out = [];
  MODEL.items.forEach((it, idx) => { if (it.type === 'row') out.push({ idx, r: it.row }); });
  return out;
}

function refreshMapFilter() {
  const sel = $('mapFilter');
  const cur = sel.value;
  const seen = new Set();
  sel.innerHTML = '<option value="">全部地图</option>';
  for (const { r } of rows()) {
    const id = mapIdOf(r);
    const up = id.toUpperCase();
    if (!id || seen.has(up)) continue;
    seen.add(up);
    const opt = document.createElement('option');
    opt.value = up;
    opt.textContent = id + (mapName(id) ? ' ' + mapName(id) : '');
    sel.appendChild(opt);
  }
  sel.value = cur;
}

function renderList() {
  const list = $('rowList');
  list.innerHTML = '';
  refreshMapFilter();
  const kw = filter.trim().toLowerCase();
  const mapFilter = $('mapFilter').value;
  const groups = new Map(); // 地图号 -> [{idx, r}]
  for (const { idx, r } of rows()) {
    const mapId = mapIdOf(r);
    if (mapFilter && mapId.toUpperCase() !== mapFilter) continue;
    if (kw && !(field(r, 0).toLowerCase().includes(kw)
      || field(r, 4).toLowerCase().includes(kw)
      || mapId.toLowerCase().includes(kw)
      || mapName(mapId).toLowerCase().includes(kw))) continue;
    const key = mapId || '(未填地图)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ idx, r });
  }
  for (const [key, arr] of groups) {
    const isCollapsed = collapsed.has(key);
    const head = document.createElement('div');
    head.className = 'group-head';
    const dispName = mapName(key);
    head.innerHTML = '<span class="caret">' + (isCollapsed ? '▸' : '▾') + '</span><span class="gkey"></span>'
      + (dispName ? ' <span class="gname2"></span>' : '') + ' <span style="opacity:.7">（' + arr.length + '）</span>';
    head.querySelector('.gkey').textContent = key;
    if (dispName) head.querySelector('.gname2').textContent = dispName;
    head.title = dispName ? key + ' ' + dispName : key;
    head.onclick = () => {
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      renderList();
    };
    list.appendChild(head);
    if (isCollapsed) continue;
    for (const { idx, r } of arr) {
      const div = document.createElement('div');
      div.className = 'npc-item' + (idx === selected ? ' selected' : '');
      const info = 'x:' + field(r, 2) + ' y:' + field(r, 3);
      div.innerHTML = '<span class="gname"></span><span class="ginfo"></span><button class="del" title="删除">×</button>';
      div.querySelector('.gname').textContent = field(r, 4) || field(r, 0) || '(未命名)';
      div.querySelector('.ginfo').textContent = info;
      div.onclick = (ev) => {
        if (ev.target.classList.contains('del')) return;
        selected = idx; renderList(); renderForm();
      };
      div.querySelector('.del').onclick = () => {
        MODEL.items.splice(idx, 1);
        if (selected === idx) selected = -1;
        else if (selected > idx) selected--;
        markDirty(); renderList(); renderForm();
      };
      list.appendChild(div);
    }
  }
}

const GROUP_ORDER = ['基本', '外观', '行为', '封号'];

function renderForm() {
  const main = $('rowForm');
  main.innerHTML = '';
  const item = selected >= 0 ? MODEL.items[selected] : null;
  if (!item || item.type !== 'row') {
    main.innerHTML = '<div class="empty-hint">在左侧选择一个NPC，或点击「新增NPC」</div>';
    return;
  }
  const r = item.row;
  for (const group of GROUP_ORDER) {
    const sec = document.createElement('div');
    sec.className = 'section-title';
    sec.textContent = group;
    main.appendChild(sec);
    const grid = document.createElement('div');
    grid.className = 'fields';
    COLUMNS.forEach((col, i) => {
      if (col.group !== group) return;
      const f = document.createElement('div');
      f.className = 'field';
      const lb = document.createElement('label');
      lb.textContent = col.label;
      const inp = document.createElement('input');
      inp.type = 'text';
      if (col.hint) inp.placeholder = col.hint;
      inp.value = field(r, i);
      inp.oninput = () => { setField(r, i, inp.value); markDirty(); renderList(); };
      f.appendChild(lb); f.appendChild(inp);
      if (i === 0) {
        // 文件名：说明 Market_def 脚本路径规则
        const hint = document.createElement('label');
        hint.className = 'extra-hint';
        hint.textContent = '脚本: Envir\\Market_def\\<文件名>-<地图号>.txt';
        f.appendChild(hint);
        const openBtn = document.createElement('button');
        openBtn.className = 'btn secondary';
        openBtn.style.cssText = 'padding:2px 10px;font-size:11px;align-self:flex-start';
        openBtn.textContent = '打开脚本 ↗';
        openBtn.title = '打开对应的 Market_def 脚本文件，不存在时可创建';
        openBtn.onclick = () => vscode.postMessage({ type: 'openScript', name: field(r, 0), map: field(r, 1) });
        f.appendChild(openBtn);
      } else if (i === 1) {
        // 地图名：显示 MapInfo.txt 中的地图名称
        const nameHint = document.createElement('label');
        nameHint.style.cssText = 'color:var(--vscode-charts-green,#6f6)';
        const syncNameHint = () => { nameHint.textContent = mapName(inp.value.trim()) || ''; };
        syncNameHint();
        const origOninput = inp.oninput;
        inp.oninput = () => { origOninput(); syncNameHint(); };
        f.appendChild(nameHint);
      }
      grid.appendChild(f);
    });
    main.appendChild(grid);
  }
}

$('searchInput').oninput = (ev) => { filter = ev.target.value; renderList(); };
$('mapFilter').onchange = () => renderList();
$('addRowBtn').onclick = () => {
  const fields = [];
  // 新增时沿用当前选中行的地图号，减少重复输入
  if (selected >= 0 && MODEL.items[selected] && MODEL.items[selected].type === 'row') {
    fields[1] = field(MODEL.items[selected].row, 1);
  }
  MODEL.items.push({ type: 'row', row: { fields } });
  selected = MODEL.items.length - 1;
  markDirty(); renderList(); renderForm();
};
$('saveBtn').onclick = () => {
  $('toast').textContent = '保存中…';
  $('toast').className = 'toast';
  vscode.postMessage({ type: 'save', model: MODEL });
};
$('refreshBtn').onclick = () => vscode.postMessage({ type: 'refresh' });
$('alignBtn').onclick = () => {
  // 仅整理空白（保存时统一单空格分隔，中间空列自动写 ; 占位保持列位）
  for (const it of MODEL.items) {
    if (it.type !== 'row') continue;
    it.row.fields = it.row.fields.map((f) => String(f).trim());
  }
  $('alignNotice').style.display = 'none';
  markDirty(); renderList(); renderForm();
  $('toast').textContent = '已对齐，保存后生效';
  $('toast').className = 'toast ok';
};
$('alignDismiss').onclick = () => { $('alignNotice').style.display = 'none'; };

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    MODEL = msg.model;
    COLUMNS = msg.columns;
    MAPNAMES = msg.mapNames || {};
    selected = -1;
    clearDirty();
    $('pathHint').textContent = msg.filePath;
    $('pathHint').title = msg.filePath;
    $('alignNotice').style.display = msg.messy ? 'flex' : 'none';
    renderList(); renderForm();
  } else if (msg.type === 'saveResult') {
    if (msg.ok) { clearDirty(); $('toast').textContent = '已保存'; $('toast').className = 'toast ok'; }
    else { $('toast').textContent = '保存失败：' + msg.error; $('toast').className = 'toast err'; }
  }
});

makeResizable('split1', 'npcSidebar', 'npcSidebarW', 300, 180, 600);

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
