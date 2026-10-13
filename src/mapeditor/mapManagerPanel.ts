import * as vscode from 'vscode';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { decodeScript } from '../scanner/scanCore';
import {
  MapInfoModel, MiniMapModel,
  parseMapInfo, serializeMapInfo, parseMiniMap, serializeMiniMap,
} from './mapModel';
import mapParamsData from '../data/mapParams.json';

export interface MapParamDef {
  name: string;
  arg: 'none' | 'number' | 'text' | 'label' | 'list' | 'pair' | 'delayLabel' | 'secret' | 'optionalNumber' | 'optionalLabel';
  argHint?: string;
  desc: string;
  group: string;
}

const PARAM_CATALOG = mapParamsData as { groups: string[]; params: MapParamDef[] };

const MAPINFO_RE = /^mapinfo\.txt$/i;
const MINIMAP_RE = /^minimap\.txt$/i;
const MONGEN_RE = /^mongen\.txt$/i;
const MERCHANT_RE = /^merchant\.txt$/i;

/** 判断文件是否为可可视化管理的配置文件 (MapInfo.txt / MiniMap.txt / MonGen.txt) */
export function isMapConfigFile(fsPath: string): boolean {
  const base = path.basename(fsPath);
  return MAPINFO_RE.test(base) || MINIMAP_RE.test(base) || MONGEN_RE.test(base);
}

export function isMonGenFile(fsPath: string): boolean {
  return MONGEN_RE.test(path.basename(fsPath));
}

/** 判断是否为 Merchant.txt（交易NPC配置文件） */
export function isMerchantFile(fsPath: string): boolean {
  return MERCHANT_RE.test(path.basename(fsPath));
}

/** 判断是否位于 MonItems 目录下的 txt（爆率文件） */
export function isMonItemFile(fsPath: string): boolean {
  if (!fsPath.toLowerCase().endsWith('.txt')) return false;
  return fsPath.split(/[\\/]/).some((p) => p.toLowerCase() === 'monitems');
}

async function readModelFile<T>(uri: vscode.Uri, parse: (t: string) => T): Promise<{ model: T; exists: boolean }> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { model: parse(decodeScript(bytes)), exists: true };
  } catch {
    return { model: parse(''), exists: false };
  }
}

export class MapManagerPanel {
  private static current: MapManagerPanel | undefined;

  static show(context: vscode.ExtensionContext, anchorFile: vscode.Uri): void {
    if (MapManagerPanel.current) {
      MapManagerPanel.current.panel.reveal();
      MapManagerPanel.current.setAnchor(anchorFile);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'm2script.mapManager',
      '地图管理器',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MapManagerPanel.current = new MapManagerPanel(context, panel, anchorFile);
  }

  private mapInfoUri!: vscode.Uri;
  private miniMapUri!: vscode.Uri;
  private mapInfo!: MapInfoModel;
  private miniMap!: MiniMapModel;
  private miniMapExists = false;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    anchorFile: vscode.Uri,
  ) {
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.png'));
    panel.onDidDispose(() => { MapManagerPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, context.subscriptions);
    panel.webview.html = this.renderHtml(panel.webview);
    this.setAnchor(anchorFile);
  }

  private setAnchor(anchorFile: vscode.Uri): void {
    const dir = path.dirname(anchorFile.fsPath);
    const base = path.basename(anchorFile.fsPath);
    if (MINIMAP_RE.test(base)) {
      this.miniMapUri = anchorFile;
      this.mapInfoUri = vscode.Uri.file(path.join(dir, 'MapInfo.txt'));
    } else {
      this.mapInfoUri = anchorFile;
      this.miniMapUri = vscode.Uri.file(path.join(dir, 'MiniMap.txt'));
    }
    void this.load();
  }

  private async load(): Promise<void> {
    const mi = await readModelFile(this.mapInfoUri, parseMapInfo);
    const mm = await readModelFile(this.miniMapUri, parseMiniMap);
    this.mapInfo = mi.model;
    this.miniMap = mm.model;
    this.miniMapExists = mm.exists;
    this.panel.title = `地图管理器 - ${path.basename(this.mapInfoUri.fsPath)}`;
    this.panel.webview.postMessage({
      type: 'load',
      mapInfo: this.mapInfo,
      miniMap: this.miniMap,
      params: PARAM_CATALOG,
      mapInfoPath: this.mapInfoUri.fsPath,
      miniMapPath: this.miniMapUri.fsPath,
    });
  }

  private async onMessage(msg: { type: string; mapInfo?: MapInfoModel; miniMap?: MiniMapModel }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.load();
        break;
      case 'refresh':
        await this.load();
        break;
      case 'save': {
        if (!msg.mapInfo || !msg.miniMap) return;
        const err = await this.save(msg.mapInfo, msg.miniMap);
        this.panel.webview.postMessage(err ? { type: 'saveResult', ok: false, error: err } : { type: 'saveResult', ok: true });
        break;
      }
    }
  }

  /** 写盘。若文件已在编辑器打开且有未保存改动则拒绝，避免互相覆盖 */
  private async save(mapInfo: MapInfoModel, miniMap: MiniMapModel): Promise<string | undefined> {
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isDirty) continue;
      if (doc.uri.fsPath === this.mapInfoUri.fsPath || doc.uri.fsPath === this.miniMapUri.fsPath) {
        return `${path.basename(doc.uri.fsPath)} 在编辑器中有未保存的改动，请先保存或还原后再试`;
      }
    }
    try {
      const mapInfoText = serializeMapInfo(mapInfo);
      await vscode.workspace.fs.writeFile(this.mapInfoUri, iconv.encode(mapInfoText, 'gbk'));
      // MiniMap.txt 原本不存在且没有任何数据行时不创建空文件
      const hasRows = miniMap.items.some((i) => i.type === 'row');
      if (this.miniMapExists || hasRows) {
        const miniMapText = serializeMiniMap(miniMap);
        await vscode.workspace.fs.writeFile(this.miniMapUri, iconv.encode(miniMapText, 'gbk'));
        this.miniMapExists = true;
      }
      this.mapInfo = mapInfo;
      this.miniMap = miniMap;
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
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
  .tabs { display: flex; gap: 4px; }
  .tab {
    padding: 3px 12px; font-size: 12px; border-radius: 12px; cursor: pointer; user-select: none;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15));
    color: var(--vscode-button-secondaryForeground, inherit); opacity: .75;
  }
  .tab:hover { opacity: 1; }
  .tab.active { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
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

  .body { flex: 1; display: flex; overflow: hidden; }
  .page { display: none; flex: 1; overflow: hidden; }
  .page.active { display: flex; }

  /* 地图页 */
  .sidebar {
    width: 250px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  }
  .sidebar .search { padding: 10px; }
  .sidebar input[type=text], .sidebar input:not([type]) {
    width: 100%; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 5px 9px; font-size: 12px; outline: none;
  }
  .map-list { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
  .map-item {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px;
    cursor: pointer; user-select: none; margin-bottom: 2px;
  }
  .map-item:hover { background: var(--vscode-list-hoverBackground); }
  .map-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .map-item .mid { font-family: var(--vscode-editor-font-family); font-weight: 600; font-size: 12px; }
  .map-item .mname { font-size: 12px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 8px; line-height: 15px; flex-shrink: 0; }
  .badge.mirror { background: rgba(150, 100, 220, .2); color: var(--vscode-charts-purple, #b180d7); }
  .mmini {
    font-size: 10px; opacity: .5; flex-shrink: 0;
    font-family: var(--vscode-editor-font-family);
  }
  .map-item .del { visibility: hidden; border: none; background: none; cursor: pointer; color: inherit; opacity: .5; font-size: 13px; padding: 0 2px; }
  .map-item:hover .del { visibility: visible; }
  .map-item .del:hover { opacity: 1; color: var(--vscode-errorForeground, #f66); }
  .add-bar { padding: 8px 10px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
  .splitter { width: 5px; cursor: col-resize; flex-shrink: 0; }
  .splitter:hover, .splitter.active { background: var(--vscode-focusBorder); opacity: .5; }
  .splitter.active { opacity: .8; }

  .main { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .empty-hint { opacity: .45; text-align: center; margin-top: 80px; font-size: 13px; }
  .form-row { display: flex; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 11px; opacity: .6; }
  .field input[type=text], .field input:not([type]) {
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 6px 10px; font-size: 13px; outline: none; min-width: 160px;
  }
  .field input:focus { border-color: var(--vscode-focusBorder); }
  .radios { display: flex; gap: 8px; flex-wrap: wrap; }
  .radio {
    display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); border-radius: 6px; padding: 5px 10px;
  }
  .radio.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
  .radio input { accent-color: var(--vscode-button-background); }
  .section-title {
    font-size: 11px; font-weight: 600; letter-spacing: .5px; opacity: .55;
    margin: 18px 0 8px; display: flex; align-items: center; gap: 8px;
  }
  .section-title::after { content: ''; flex: 1; height: 1px; background: var(--vscode-panel-border, rgba(128,128,128,.2)); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; user-select: none;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); border-radius: 13px; padding: 3px 10px;
    opacity: .75;
  }
  .chip:hover { opacity: 1; }
  .chip.on {
    opacity: 1; border-color: var(--vscode-button-background);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .chip .arg-input {
    border: none; border-radius: 4px; background: rgba(255,255,255,.18); color: inherit;
    font-size: 11px; padding: 1px 6px; width: 130px; outline: none;
  }
  .chip .arg-input::placeholder { color: rgba(255,255,255,.55); }

  /* 小地图页 */
  .mini-page { flex-direction: column; padding: 16px 20px; overflow-y: auto; }
  .mini-table { border-collapse: collapse; min-width: 380px; }
  .mini-table th { font-size: 11px; opacity: .55; text-align: left; padding: 4px 10px; font-weight: 600; }
  .mini-table td { padding: 3px 6px; }
  .mini-table input {
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    padding: 4px 9px; font-size: 12px; outline: none; width: 160px;
    font-family: var(--vscode-editor-font-family);
  }
  .mini-table input:focus { border-color: var(--vscode-focusBorder); }
</style>
</head>
<body>
  <div class="toolbar" id="toolbar">
    <span class="title">地图管理器</span>
    <div class="tabs">
      <span class="tab active" data-page="maps">地图</span>
      <span class="tab" data-page="mini">小地图</span>
    </div>
    <span class="path" id="pathHint"></span>
    <span class="toast" id="toast"></span>
    <button class="btn secondary" id="refreshBtn" title="从磁盘重新加载">刷新</button>
    <button class="btn" id="saveBtn"><span class="dot"></span>保存</button>
  </div>
  <div class="body">
    <div class="page active" id="page-maps">
      <div class="sidebar" id="mapSidebar">
        <div class="search"><input type="text" id="searchInput" placeholder="搜索地图号 / 名称…"></div>
        <div class="map-list" id="mapList"></div>
        <div class="add-bar"><button class="btn secondary" id="addMapBtn" style="width:100%">＋ 新增地图</button></div>
      </div>
      <div class="splitter" id="split1"></div>
      <div class="main" id="mapForm"></div>
    </div>
    <div class="page mini-page" id="page-mini">
      <table class="mini-table">
        <thead><tr><th>地图编号</th><th>小地图编号</th><th></th></tr></thead>
        <tbody id="miniBody"></tbody>
      </table>
      <div style="margin-top:10px"><button class="btn secondary" id="addMiniBtn">＋ 新增一行</button></div>
      <div style="margin-top:14px;font-size:11px;opacity:.5">格式：地图编号 → 客户端 wpf 文件内 mmap 的对应编号；保存写入 MiniMap.txt</div>
    </div>
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
    const onUp = (ev) => {
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
let MAPINFO = { items: [] };
let MINIMAP = { items: [] };
let CATALOG = { groups: [], params: [] };
let selected = -1;      // mapInfo.items 中的下标
let dirty = false;
let filter = '';

const $ = (id) => document.getElementById(id);

function markDirty() {
  dirty = true;
  $('toolbar').classList.add('dirty');
  $('toast').textContent = '';
  $('toast').className = 'toast';
}
function clearDirty() {
  dirty = false;
  $('toolbar').classList.remove('dirty');
}

function entries() {
  const out = [];
  MAPINFO.items.forEach((it, idx) => { if (it.type === 'entry') out.push({ it, idx, e: it.entry }); });
  return out;
}

function kindLabel(e) {
  return e.kind === 'mirrorReuse' ? '镜像·沿用' : e.kind === 'mirrorIndependent' ? '镜像·独立' : '';
}

function renderList() {
  const list = $('mapList');
  list.innerHTML = '';
  const kw = filter.trim().toLowerCase();
  const miniOf = (mapId) => {
    for (const it of MINIMAP.items) if (it.type === 'row' && it.row.mapId === mapId) return it.row.miniMapId;
    return '';
  };
  for (const { it, idx, e } of entries()) {
    if (kw && !(e.id.toLowerCase().includes(kw) || e.name.toLowerCase().includes(kw) || (e.srcId || '').toLowerCase().includes(kw))) continue;
    const div = document.createElement('div');
    div.className = 'map-item' + (idx === selected ? ' selected' : '');
    const badge = kindLabel(e);
    const mm = e.kind === 'mirrorReuse' ? '' : miniOf(e.id);
    div.innerHTML = '<span class="mid"></span><span class="mname"></span>'
      + (mm ? '<span class="mmini"></span>' : '')
      + (badge ? '<span class="badge mirror">' + badge + '</span>' : '')
      + '<button class="del" title="删除该地图">×</button>';
    div.querySelector('.mid').textContent = e.id;
    div.querySelector('.mname').textContent = e.name;
    if (mm) div.querySelector('.mmini').textContent = mm;
    div.onclick = (ev) => {
      if (ev.target.classList.contains('del')) return;
      selected = idx; renderList(); renderForm();
    };
    div.querySelector('.del').onclick = () => {
      MAPINFO.items.splice(idx, 1);
      if (selected === idx) selected = -1;
      else if (selected > idx) selected--;
      markDirty(); renderList(); renderForm();
    };
    list.appendChild(div);
  }
}

function findParamDef(name) {
  const up = name.toUpperCase();
  return CATALOG.params.find((p) => p.name.toUpperCase() === up);
}

function renderForm() {
  const main = $('mapForm');
  main.innerHTML = '';
  const item = selected >= 0 ? MAPINFO.items[selected] : null;
  if (!item || item.type !== 'entry') {
    main.innerHTML = '<div class="empty-hint">在左侧选择一张地图，或点击「新增地图」</div>';
    return;
  }
  const e = item.entry;

  // 基本信息（含小地图编号，直接读写 MiniMap.txt 对应行）
  const findMiniRow = (mapId) => {
    for (const it of MINIMAP.items) if (it.type === 'row' && it.row.mapId === mapId) return it.row;
    return null;
  };
  const row1 = document.createElement('div');
  row1.className = 'form-row';
  row1.innerHTML =
    '<div class="field"><label>地图号（大写）</label><input type="text" id="fId"></div>' +
    '<div class="field"><label>地图名称</label><input type="text" id="fName" style="min-width:220px"></div>' +
    '<div class="field"><label>小地图编号（MiniMap.txt）</label><input type="text" id="fMini">' +
    '<label id="miniHint" style="display:none;color:var(--vscode-charts-purple,#b180d7)">沿用原图小地图，无需配置</label></div>';
  main.appendChild(row1);
  const fId = row1.querySelector('#fId');
  const fName = row1.querySelector('#fName');
  const fMini = row1.querySelector('#fMini');
  const miniHint = row1.querySelector('#miniHint');
  fId.value = e.id; fName.value = e.name;
  fMini.value = (findMiniRow(e.id) || {}).miniMapId || '';
  fId.oninput = () => {
    const oldId = e.id;
    e.id = fId.value.toUpperCase(); fId.value = e.id;
    // 地图号改名时同步 MiniMap.txt 对应行，避免对照失效
    const row = findMiniRow(oldId);
    if (row && !findMiniRow(e.id)) { row.mapId = e.id; }
    markDirty(); renderList();
  };
  fName.oninput = () => { e.name = fName.value; markDirty(); renderList(); };
  fMini.oninput = () => {
    let row = findMiniRow(e.id);
    const v = fMini.value.trim();
    if (!row && v) {
      row = { mapId: e.id, miniMapId: '' };
      MINIMAP.items.push({ type: 'row', row });
    }
    if (row) { row.miniMapId = v; markDirty(); }
    renderList();
  };

  // 映射方式
  const sec1 = document.createElement('div');
  sec1.className = 'section-title';
  sec1.textContent = '映射方式';
  main.appendChild(sec1);
  const row2 = document.createElement('div');
  row2.className = 'form-row';
  row2.innerHTML = '<div class="radios">' +
    '<label class="radio" data-k="normal"><input type="radio" name="kind">普通地图</label>' +
    '<label class="radio" data-k="mirrorReuse"><input type="radio" name="kind">镜像·沿用原图小地图 &lt;源&gt;新</label>' +
    '<label class="radio" data-k="mirrorIndependent"><input type="radio" name="kind">镜像·独立地图 源|新</label>' +
    '</div>' +
    '<div class="field" id="srcWrap" style="display:none"><label>源地图号</label><input type="text" id="fSrc"></div>';
  main.appendChild(row2);
  const fSrc = row2.querySelector('#fSrc');
  fSrc.value = e.srcId || '';
  function syncKind() {
    row2.querySelectorAll('.radio').forEach((r) => {
      const on = r.dataset.k === e.kind;
      r.classList.toggle('on', on);
      r.querySelector('input').checked = on;
    });
    row2.querySelector('#srcWrap').style.display = e.kind === 'normal' ? 'none' : '';
    // [<源>新] 沿用原图小地图，不可单独配置；[源|新] 与普通地图可独立配置
    const reuse = e.kind === 'mirrorReuse';
    fMini.disabled = reuse;
    fMini.style.opacity = reuse ? '.4' : '';
    miniHint.style.display = reuse ? '' : 'none';
  }
  row2.querySelectorAll('.radio').forEach((r) => {
    r.onclick = () => {
      e.kind = r.dataset.k;
      if (e.kind !== 'normal' && !e.srcId) { e.srcId = ''; fSrc.value = ''; }
      markDirty(); syncKind(); renderList();
    };
  });
  fSrc.oninput = () => { e.srcId = fSrc.value.toUpperCase(); fSrc.value = e.srcId; markDirty(); };
  syncKind();

  // 地图参数
  const sec2 = document.createElement('div');
  sec2.className = 'section-title';
  sec2.textContent = '地图参数';
  main.appendChild(sec2);

  const activeMap = new Map(); // 参数名大写 -> param 对象
  for (const p of e.params) activeMap.set(p.name.toUpperCase(), p);

  for (const group of CATALOG.groups) {
    const defs = CATALOG.params.filter((d) => d.group === group);
    if (!defs.length) continue;
    const g = document.createElement('div');
    g.innerHTML = '<div style="font-size:11px;opacity:.45;margin:10px 0 6px">' + group + '</div>';
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const def of defs) {
      const key = def.name.toUpperCase();
      const cur = activeMap.get(key);
      const chip = document.createElement('span');
      chip.className = 'chip' + (cur ? ' on' : '');
      chip.title = def.desc || '';
      const label = document.createElement('span');
      label.textContent = def.name;
      chip.appendChild(label);
      if (def.arg !== 'none') {
        const inp = document.createElement('input');
        inp.className = 'arg-input';
        inp.placeholder = def.argHint || '参数值';
        inp.value = cur && cur.arg !== undefined ? cur.arg : '';
        inp.style.display = cur ? '' : 'none';
        inp.onclick = (ev) => ev.stopPropagation();
        inp.oninput = () => {
          const p = activeMap.get(key);
          if (p) { p.arg = inp.value; markDirty(); }
        };
        chip.appendChild(inp);
      }
      chip.onclick = () => {
        if (activeMap.has(key)) {
          const p = activeMap.get(key);
          e.params.splice(e.params.indexOf(p), 1);
          activeMap.delete(key);
        } else {
          const p = { name: def.name };
          if (def.arg !== 'none' && !def.arg.startsWith('optional')) p.arg = '';
          e.params.push(p);
          activeMap.set(key, p);
        }
        markDirty(); renderForm();
      };
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    main.appendChild(g);
  }

  // 未识别的参数（不在目录中的），原样展示可删除
  const known = new Set(CATALOG.params.map((d) => d.name.toUpperCase()));
  const unknown = e.params.filter((p) => !known.has(p.name.toUpperCase()));
  if (unknown.length) {
    const g = document.createElement('div');
    g.innerHTML = '<div style="font-size:11px;opacity:.45;margin:10px 0 6px">未识别参数（保留）</div>';
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const p of unknown) {
      const chip = document.createElement('span');
      chip.className = 'chip on';
      chip.textContent = p.arg !== undefined ? p.name + '(' + p.arg + ')' : p.name;
      chip.title = '点击移除该参数';
      chip.onclick = () => { e.params.splice(e.params.indexOf(p), 1); markDirty(); renderForm(); };
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    main.appendChild(g);
  }
}

function renderMini() {
  const body = $('miniBody');
  body.innerHTML = '';
  MINIMAP.items.forEach((it, idx) => {
    if (it.type !== 'row') return;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input></td><td><input></td><td><button class="btn danger" title="删除">×</button></td>';
    const [a, b] = tr.querySelectorAll('input');
    a.value = it.row.mapId; b.value = it.row.miniMapId;
    a.oninput = () => { it.row.mapId = a.value; markDirty(); };
    b.oninput = () => { it.row.miniMapId = b.value; markDirty(); };
    tr.querySelector('button').onclick = () => { MINIMAP.items.splice(idx, 1); markDirty(); renderMini(); };
    body.appendChild(tr);
  });
}

// 事件绑定
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + t.dataset.page));
    if (t.dataset.page === 'maps') renderList(); // 小地图页可能改动了编号，刷新列表中的显示
  };
});
$('searchInput').oninput = (ev) => { filter = ev.target.value; renderList(); };
$('addMapBtn').onclick = () => {
  const entry = { kind: 'normal', id: 'NEW', name: '新地图', params: [] };
  MAPINFO.items.push({ type: 'entry', entry });
  selected = MAPINFO.items.length - 1;
  markDirty(); renderList(); renderForm();
};
$('addMiniBtn').onclick = () => {
  MINIMAP.items.push({ type: 'row', row: { mapId: '', miniMapId: '' } });
  markDirty(); renderMini();
};
$('saveBtn').onclick = () => {
  $('toast').textContent = '保存中…';
  $('toast').className = 'toast';
  vscode.postMessage({ type: 'save', mapInfo: MAPINFO, miniMap: MINIMAP });
};
$('refreshBtn').onclick = () => vscode.postMessage({ type: 'refresh' });

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    MAPINFO = msg.mapInfo;
    MINIMAP = msg.miniMap;
    CATALOG = msg.params;
    selected = -1;
    clearDirty();
    $('pathHint').textContent = msg.mapInfoPath;
    $('pathHint').title = msg.mapInfoPath + (msg.miniMapPath ? '\\n' + msg.miniMapPath : '');
    renderList(); renderForm(); renderMini();
  } else if (msg.type === 'saveResult') {
    if (msg.ok) { clearDirty(); $('toast').textContent = '已保存'; $('toast').className = 'toast ok'; }
    else { $('toast').textContent = '保存失败：' + msg.error; $('toast').className = 'toast err'; }
  }
});

makeResizable('split1', 'mapSidebar', 'mapSidebarW', 250, 160, 600);

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
