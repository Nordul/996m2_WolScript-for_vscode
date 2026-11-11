/** MapInfo/MiniMap 解析与序列化 round-trip 测试（直接加载编译产物，无需 vscode） */
const assert = require('assert');
const {
  parseMapInfo, serializeMapInfo, parseMiniMap, serializeMiniMap, mapInfoEntries, miniMapRows,
} = require('../out/mapeditor/mapModel');

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log('  ✓ ' + label);
}

const sample = [
  '; 这是注释',
  '',
  '[0 中州] SAFE CANRIDE',
  '[<0>new0 新中州]',
  '[0|new1 独立新中州] SAFE',
  '[F001 禁地] FIGHT EXPRATE(200) DECHP(1/10) MINE(@挖矿) CANMIRROR(3)',
  '这是一条坏行 没有中括号',
  '[M100 密室] FORBIDITEMS(豹魔石|回城神石) DELAYGOTO(10/@回城)',
].join('\r\n');

console.log('MapInfo round-trip:');
const model = parseMapInfo(sample);
const entries = mapInfoEntries(model);
ok(entries.length === 5, '解析出 5 张地图');
ok(entries[0].kind === 'normal' && entries[0].id === '0' && entries[0].name === '中州', '普通地图');
ok(entries[1].kind === 'mirrorReuse' && entries[1].srcId === '0' && entries[1].id === 'new0' && entries[1].name === '新中州', '映射方式一 <src>new');
ok(entries[2].kind === 'mirrorIndependent' && entries[2].srcId === '0' && entries[2].id === 'new1', '映射方式二 src|new');
ok(entries[3].params.length === 5, '带参参数个数');
ok(entries[3].params[1].name === 'EXPRATE' && entries[3].params[1].arg === '200', 'EXPRATE(200)');
ok(entries[3].params[2].arg === '1/10', 'DECHP(1/10) pair');
ok(entries[3].params[3].arg === '@挖矿', 'MINE(@挖矿) label');
ok(entries[4].params[0].arg === '豹魔石|回城神石', 'FORBIDITEMS list');

const text1 = serializeMapInfo(model);
const model2 = parseMapInfo(text1);
const text2 = serializeMapInfo(model2);
ok(text1 === text2, '序列化幂等');
ok(text1.includes('; 这是注释'), '注释保留');
ok(text1.includes('这是一条坏行 没有中括号'), '坏行保留');
ok(text1.split(/\r\n/).some((l) => l === ''), '空行保留');
ok(text1.includes('[<0>new0 新中州]'), '映射一原样输出');
ok(text1.includes('[0|new1 独立新中州] SAFE'), '映射二带参数输出');
ok(text1.endsWith('\r\n'), '文件末尾换行');

console.log('MiniMap round-trip:');
const mmSample = '; 小地图\r\nF001\t00161\r\nF002\t00162\r\n坏行\r\n';
const mm = parseMiniMap(mmSample);
const rows = miniMapRows(mm);
ok(rows.length === 2 && rows[0].mapId === 'F001' && rows[0].miniMapId === '00161', '解析 2 行映射');
const mmText1 = serializeMiniMap(mm);
ok(mmText1 === serializeMiniMap(parseMiniMap(mmText1)), 'MiniMap 序列化幂等');
ok(mmText1.includes('; 小地图') && mmText1.includes('坏行'), 'MiniMap 注释/坏行保留');


async function testMapContextMenu() {
  console.log('右键复制/粘贴地图 (jsdom 模拟):');
  const nodePath = require('path');
  const iconv = require('iconv-lite');
  const Module = require('module');
  const { JSDOM } = require('jsdom');
  const root = nodePath.join('D:', 'server', 'Envir');
  const miText = [
    '; 这是注释',
    '[0 中州] SAFE CANRIDE',
    '[F001 禁地] FIGHT EXPRATE(200)',
    '[F002 禁地副本] FIGHT',
  ].join('\r\n') + '\r\n';
  const mmText = '0 100\r\nF001 00161\r\nF002 00161\r\n';
  const makeUri = (fsPath) => ({ fsPath, path: fsPath.split(nodePath.sep).join('/'), scheme: 'file' });
  const posted = [];
  const fakePanel = {
    webview: {
      html: '',
      onDidReceiveMessage: () => {},
      postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
    },
    onDidDispose: () => {},
  };
  const fakeVscode = {
    Uri: { file: makeUri, joinPath: (u, ...p) => makeUri(nodePath.join(u.fsPath, ...p)) },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Active: 1 },
    window: { createWebviewPanel: () => fakePanel },
    workspace: {
      textDocuments: [],
      fs: {
        readFile: async (uri) => {
          const b = nodePath.basename(uri.fsPath).toLowerCase();
          if (b === 'mapinfo.txt') return iconv.encode(miText, 'gbk');
          if (b === 'minimap.txt') return iconv.encode(mmText, 'gbk');
          throw new Error('not found');
        },
        writeFile: async () => {},
      },
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...args) { if (request === 'vscode') return fakeVscode; return origLoad.call(this, request, ...args); };
  let MapManagerPanel;
  try { MapManagerPanel = require('../out/mapeditor/mapManagerPanel').MapManagerPanel; } finally { Module._load = origLoad; }
  const waitFor = async (predicate) => {
    for (let i = 0; i < 30; i++) { const v = predicate(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); }
    throw new Error('等待面板消息超时');
  };
  MapManagerPanel.show({ extensionPath: root, subscriptions: [] }, makeUri(nodePath.join(root, 'MapInfo.txt')));
  const load = await waitFor(() => posted.find((m) => m.type === 'load'));

  const state = {};
  const dom = new JSDOM(fakePanel.webview.html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.__posted = [];
      window.acquireVsCodeApi = () => ({ getState: () => state, setState: (s) => Object.assign(state, s), postMessage: (m) => { window.__posted.push(m); } });
    },
  });
  const win = dom.window, doc = win.document;
  try {
    win.postMessage(load, '*');
    await new Promise((r) => setTimeout(r, 50));
    const items = () => doc.querySelectorAll('.map-item');
    ok(items().length === 3, '渲染 3 张地图');
    items()[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    ok(doc.querySelectorAll('#mapForm input').length >= 4 && doc.querySelectorAll('#mapForm .radio').length === 3 && doc.querySelectorAll('#mapForm .chip').length > 0, '选中地图后表单完整渲染（含映射方式与参数）');
    items()[2].dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
    ok(doc.getElementById('ctxMenu').style.display === 'block' && doc.querySelectorAll('.ctx-item').length === 1, '未复制时菜单仅显示复制');
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent.includes('复制地图')).click();
    ok(win.eval('copiedMap.entry.id') === 'F002' && win.eval('copiedMap.miniMapId') === '00161', '复制含参数与小地图配置');
    items()[2].dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
    ok(doc.querySelectorAll('.ctx-item').length === 2, '已复制后菜单出现粘贴项');
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent.includes('粘贴地图')).click();
    ok(items().length === 4, '粘贴后地图数 3→4');
    ok(win.eval('MAPINFO.items[4].entry.id') === 'F002' && win.eval('MAPINFO.items[4].entry.name') === '禁地副本', '粘贴保留原图地图号');
    ok(win.eval('MINIMAP.items.filter((i) => i.type === "row" && i.row.mapId === "F002").length') === 1, '同号共享小地图行且不重复');
    ok(win.eval('selected') === 4, '粘贴后自动选中新地图');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(Boolean(win.eval('window.__posted.find((m) => m.type === "save")')), 'Ctrl+S 发送保存消息');
    // Ctrl+Z 撤销粘贴
    const countBefore = win.eval('MAPINFO.items.length');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MAPINFO.items.length') === countBefore - 1 && win.eval('MAPINFO.items.filter((i) => i.type === "entry").map((i) => i.entry.id).join()').endsWith('F002'), 'Ctrl+Z 撤销粘贴的地图');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MAPINFO.items.length') === countBefore, 'Ctrl+Shift+Z 重做恢复');
  } finally { win.close(); }
}

testMapContextMenu().then(() => {
  console.log('\n全部通过: ' + passed + ' 项');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
