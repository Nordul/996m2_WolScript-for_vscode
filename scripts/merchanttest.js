/** Merchant.txt 解析与序列化 round-trip 测试（直接加载编译产物，无需 vscode） */
const assert = require('assert');
const {
  parseMerchant, serializeMerchant, merchantRows, rowField, setRowField,
  MERCHANT_COLUMNS, MERCHANT_MIN_COLUMNS, merchantNeedsAlignment, merchantScriptRel,
  merchantScriptCandidates,
} = require('../out/mapeditor/merchantModel');

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log('  ✓ ' + label);
}

const sample = [
  ';文件名\t地图名\t坐标X\t坐标Y\tNPC显示名称\tNPC标识\t形象代码\t是否沙城NPC',
  '',
  '中州\\老兵\t0\t468\t226\t老兵\t0\t0\t0\t0\t0\t0\t0\t0',
  '同读<功能测试> 88003 150 820 测试功能 0 15 0',
  '铁匠 0 300 300 武器店老板 0 20 0 0 0 1 2 3',
  '坏行',
].join('\r\n');

console.log('Merchant round-trip:');
const model = parseMerchant(sample);
const rows = merchantRows(model);
ok(rows.length === 3, '解析出 3 条NPC记录');
ok(MERCHANT_MIN_COLUMNS === 8, 'MIN_COLUMNS=8');
ok(rows[0].fields.length === 13, '13 列旧行兼容');
ok(rowField(rows[0], 0) === '中州\\老兵' && rowField(rows[0], 1) === '0', '文件名/地图名');
ok(rowField(rows[0], 4) === '老兵' && rowField(rows[0], 2) === '468' && rowField(rows[0], 3) === '226', 'NPC显示名称/坐标');
ok(rowField(rows[0], 12) === '0', '封号3列');
ok(rows[1].fields.length === 8, '最少 8 列边界可解析');
ok(rowField(rows[1], 0) === '同读<功能测试>' && rowField(rows[1], 6) === '15', '同读文件名/形象代码');
ok(rowField(rows[1], 7) === '0', '第 8 列是否沙城NPC');
ok(rows[2].fields.length === 13 && rowField(rows[2], 10) === '1' && rowField(rows[2], 12) === '3', '15 列满行');
ok(rowField(rows[2], 13) === '', '越界列返回空串');

setRowField(rows[1], 8, '0');
ok(rows[1].fields.length === 9 && rowField(rows[1], 8) === '0', 'setRowField 连续列扩展');

const text1 = serializeMerchant(model);
const text2 = serializeMerchant(parseMerchant(text1));
ok(text1 === text2, '序列化幂等');
ok(text1.startsWith(';文件名'), '注释保留');
ok(text1.includes('坏行'), '坏行保留');
ok(text1.includes('\r\n\r\n'), '空行保留');
ok(text1.endsWith('\r\n'), '文件末尾换行');
ok(!/\t| {2}/.test(text1.split('\r\n').filter((l) => l && !l.startsWith(';')).join('\n')), '输出为单空格分隔');
ok(MERCHANT_COLUMNS.length === 15, '列定义 15 条');
ok(MERCHANT_COLUMNS[0].group === '基本' && MERCHANT_COLUMNS[0].label === '文件名', '第 1 列文件名');
ok(MERCHANT_COLUMNS[7].label === '是否沙城NPC' && MERCHANT_COLUMNS[8].label === 'NPC是否可移动', '第 8/9 列行为');

// 少于 8 列是坏行，原样保留
const mShort = parseMerchant('中州\\老兵 0 468 226 老兵 0 0');
ok(merchantRows(mShort).length === 0 && serializeMerchant(mShort).includes('中州\\老兵 0 468 226 老兵 0 0'), '7 列坏行原样保留');
ok(merchantRows(parseMerchant('中州\\老兵 0 468 226 老兵 0 0 1')).length === 1, '恰好 8 列解析为数据行');

// 空字段占位符 ;：解析保留列位，序列化中间空列写回 ;，行尾空列丢弃
const m2 = parseMerchant('铁匠\t0\t300\t300\t老板\t0\t20\t;\t30');
ok(merchantRows(m2)[0].fields.length === 9 && rowField(merchantRows(m2)[0], 7) === ';', 'Tab 行解析保留 ; 占位列位');
ok(serializeMerchant(m2).includes('铁匠 0 300 300 老板 0 20 ; 30'), '中间空列写回 ; 占位');
const m3 = parseMerchant('铁匠 0 300 300 老板 0 20 ; 0 0 1');
ok(serializeMerchant(m3).includes('铁匠 0 300 300 老板 0 20 ; 0 0 1'), '; 占位列位不变');
const m4 = parseMerchant('铁匠 0 300 300 老板 0 20 ; ;');
ok(serializeMerchant(m4).includes('铁匠 0 300 300 老板 0 20\r\n'), '行尾空列/占位丢弃');

console.log('对齐检测:');
ok(merchantNeedsAlignment('铁匠\t0\t300\t300\t老板\t0\t20\t0'), '含 TAB 需对齐');
ok(merchantNeedsAlignment('铁匠  0 300 300 老板 0 20 0'), '含多空格需对齐');
ok(!merchantNeedsAlignment('铁匠 0 300 300 老板 0 20 0'), '单空格无需对齐');
ok(!merchantNeedsAlignment(';注释\t含\tTAB 不检测'), '注释行不检测');
ok(!merchantNeedsAlignment('；全角分号注释  也不检测'), '全角分号注释');

console.log('脚本路径解析:');
ok(merchantScriptRel('中州\\老兵', '0') === '中州\\老兵-0', '普通NPC带地图号后缀');
ok(merchantScriptRel('同读<功能测试>', '88003') === '同读<功能测试>', '同读前缀不带地图号');
const c1 = merchantScriptCandidates('同读<传送门/机关传送门>', 'JGZL');
ok(c1.includes('同读<传送门\\机关传送门>') && c1.includes('传送门\\同读<机关传送门>') && c1.includes('传送门\\机关传送门'),
  '同读<目录/文件> 生成多种布局候选: ' + JSON.stringify(c1));
const c2 = merchantScriptCandidates('中州\\老兵', '0');
ok(c2.length === 1 && c2[0] === '中州\\老兵-0', '普通NPC只有一个候选');

console.log('XLS 读取与写回:');
const XLSX = require('xlsx');
const { parseMerchantWorkbook, serializeMerchantWorkbook } = require('../out/mapeditor/merchantXls');
const mwb = XLSX.utils.book_new();
const header = ['文件名', '地图名', '坐标X', '坐标Y', 'NPC显示名称', 'NPC标识', '形象代码', '是否沙城NPC'];
const msheet = XLSX.utils.aoa_to_sheet([
  header,
  ['//注释：传送NPC', '', '', '', '', '', '', ''],
  ['中州\\老兵', '0', 468, 226, '老兵', 0, 0, 0, 0, 0, 0, 0, 0],
  ['同读<功能测试>', '88003', 150, 820, '测试功能', '0', 15, 0],
  ['铁匠', '0', 300, 300, '武器店老板', '0', '20', 0, '', 0, 1, 2, 3],
]);
XLSX.utils.book_append_sheet(mwb, msheet, 'Merchant');
XLSX.utils.book_append_sheet(mwb, XLSX.utils.aoa_to_sheet([['此工作表必须保留']]), '说明');
const merchantXlsBytes = XLSX.write(mwb, { type: 'buffer', bookType: 'xls' });
const parsedMx = parseMerchantWorkbook(merchantXlsBytes);
const mxRows = merchantRows(parsedMx.model);
ok(parsedMx.sheetName === 'Merchant', '选中包含NPC记录的工作表');
ok(mxRows.length === 3, 'XLS 解析出 3 条NPC记录，双斜线行不计入');
ok(parsedMx.model.items[0].type === 'raw' && parsedMx.model.items[0].text.split('\t')[0] === '文件名', 'XLS 中文表头不作为NPC记录');
ok(parsedMx.model.items[1].type === 'raw' && parsedMx.model.items[1].text.startsWith('//注释'), 'XLS 双斜线注释原样保留');
ok(rowField(mxRows[0], 0) === '中州\\老兵' && rowField(mxRows[0], 4) === '老兵' && rowField(mxRows[0], 2) === '468', '文件名/名称/坐标（数字单元格转字符串）');
ok(rowField(mxRows[2], 8) === '' && rowField(mxRows[2], 9) === '0', 'XLS 中间空列位置不变');
setRowField(mxRows[0], 4, '中州老兵长');
const writtenMx = serializeMerchantWorkbook(parsedMx.model, parsedMx.workbook, parsedMx.sheetName);
ok(writtenMx[0] === 0xD0 && writtenMx[1] === 0xCF && writtenMx[2] === 0x11 && writtenMx[3] === 0xE0, '写回真实 XLS（BIFF）文件');
const reparsedMx = parseMerchantWorkbook(writtenMx);
ok(rowField(merchantRows(reparsedMx.model)[0], 4) === '中州老兵长', 'XLS 修改后重新读取生效');
ok(reparsedMx.model.items[0].type === 'raw' && reparsedMx.model.items[0].text.split('\t')[0] === '文件名', 'XLS 写回保留表头');
ok(reparsedMx.workbook.SheetNames.includes('说明'), 'XLS 写回保留其他工作表');
const otherSheet = XLSX.utils.sheet_to_json(reparsedMx.workbook.Sheets['说明'], { header: 1 });
ok(otherSheet[0][0] === '此工作表必须保留', '其他工作表内容不变');

async function testPanelPrefersXls() {
  console.log('管理器 Data/merchant.xls 优先级:');
  const nodePath = require('path');
  const iconv = require('iconv-lite');
  const Module = require('module');
  const origLoad = Module._load;
  const root = nodePath.join('D:', 'server', 'Envir');
  const txtPath = nodePath.join(root, 'Merchant.txt');
  const xlsPath = nodePath.join(root, 'Data', 'merchant.xls');
  const posted = [];
  const writes = [];
  let messageHandler;
  const makeUri = (fsPath) => ({ fsPath, path: fsPath.replace(/\\/g, '/'), scheme: 'file' });
  const fakePanel = {
    webview: {
      html: '',
      onDidReceiveMessage: (handler) => { messageHandler = handler; },
      postMessage: (msg) => { posted.push(msg); return Promise.resolve(true); },
    },
    onDidDispose: () => {},
  };
  const fakeVscode = {
    Uri: {
      file: makeUri,
      joinPath: (uri, ...parts) => makeUri(nodePath.join(uri.fsPath, ...parts)),
    },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Active: 1 },
    window: { createWebviewPanel: () => fakePanel },
    workspace: {
      textDocuments: [],
      fs: {
        readDirectory: async (uri) => {
          const base = nodePath.basename(uri.fsPath).toLowerCase();
          if (base === 'envir') return [['Data', 2]];
          if (base === 'data') return [['merchant.xls', 1]];
          throw new Error('not found');
        },
        readFile: async (uri) => {
          if (uri.fsPath.toLowerCase() === xlsPath.toLowerCase()) return merchantXlsBytes;
          if (uri.fsPath.toLowerCase() === txtPath.toLowerCase()) {
            return iconv.encode('中州\\老兵Txt 0 468 226 TXT老板 0 0 0', 'gbk');
          }
          throw new Error('not found');
        },
        writeFile: async (uri, bytes) => { writes.push({ fsPath: uri.fsPath, bytes }); },
      },
    },
  };
  Module._load = function (request, ...args) {
    if (request === 'vscode') return fakeVscode;
    return origLoad.call(this, request, ...args);
  };
  let MerchantPanel, MerchantCustomEditorProvider, isMerchantFile;
  try {
    MerchantPanel = require('../out/mapeditor/merchantPanel').MerchantPanel;
    MerchantCustomEditorProvider = require('../out/mapeditor/merchantCustomEditor').MerchantCustomEditorProvider;
    isMerchantFile = require('../out/mapeditor/mapManagerPanel').isMerchantFile;
  } finally {
    Module._load = origLoad;
  }
  const waitFor = async (predicate) => {
    for (let i = 0; i < 30; i++) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('等待管理器消息超时');
  };
  MerchantPanel.show({ extensionPath: root, subscriptions: [] }, makeUri(txtPath));
  const load = await waitFor(() => posted.find((msg) => msg.type === 'load'));
  ok(load.sourceKind === 'xls' && load.filePath.toLowerCase() === xlsPath.toLowerCase(), '同时存在时优先加载 Data/merchant.xls');
  ok(merchantRows(load.model)[0] && rowField(merchantRows(load.model)[0], 4) === '老兵', '管理器未错误读取 TXT 内容');
  const edited = JSON.parse(JSON.stringify(load.model));
  setRowField(merchantRows(edited)[0], 4, 'XLS已修改');
  messageHandler({ type: 'save', model: edited });
  await waitFor(() => posted.find((msg) => msg.type === 'saveResult' && msg.ok));
  ok(writes.length === 1 && writes[0].fsPath.toLowerCase() === xlsPath.toLowerCase(), '保存写回 XLS 而非 TXT');
  ok(rowField(merchantRows(parseMerchantWorkbook(writes[0].bytes).model)[0], 4) === 'XLS已修改', '管理器保存的 XLS 可重新读取');

  console.log('直接打开 Merchant.xls:');
  ok(isMerchantFile(xlsPath) && isMerchantFile(txtPath), '文件识别同时支持 Merchant.xls 与 Merchant.txt');
  const customEditor = require('../package.json').contributes.customEditors
    .find((editor) => editor.viewType === 'm2script.merchantXls');
  ok(customEditor && customEditor.priority === 'default' && customEditor.selector.length === 3, 'XLS 自定义编辑器默认打开声明');
  const directPosted = [];
  const directPanel = {
    webview: {
      options: {}, html: '',
      onDidReceiveMessage: () => {},
      postMessage: (msg) => { directPosted.push(msg); return Promise.resolve(true); },
    },
    onDidDispose: () => {},
  };
  const provider = new MerchantCustomEditorProvider({ extensionPath: root, subscriptions: [] });
  const document = provider.openCustomDocument(makeUri(xlsPath));
  provider.resolveCustomEditor(document, directPanel);
  const directLoad = await waitFor(() => directPosted.find((msg) => msg.type === 'load'));
  ok(directPanel.webview.options.enableScripts === true, '直接打开时启用面板 Webview 脚本');
  ok(directLoad.sourceKind === 'xls' && directLoad.filePath.toLowerCase() === xlsPath.toLowerCase(), '直接打开 XLS 时读取文件自身');
  ok(rowField(merchantRows(directLoad.model)[0], 4) === '老兵', '直接打开 XLS 显示正确NPC数据');
  return { html: fakePanel.webview.html, load };
}

/** 用 jsdom 在 Node 中真实运行 Webview 脚本，模拟指针拖动、分页与脚本按钮（无需浏览器） */
async function testWebviewTable(panel) {
  console.log('表格界面交互 (jsdom 模拟):');
  const { JSDOM } = require('jsdom');
  const state = {};
  const postedByWebview = [];
  const dom = new JSDOM(panel.html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.acquireVsCodeApi = () => ({
        getState: () => state,
        setState: (s) => Object.assign(state, s),
        postMessage: (m) => { postedByWebview.push(m); },
      });
      window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: String(t).length * 7 }) });
    },
  });
  const win = dom.window;
  const doc = win.document;
  try {
    // 扩展到 123 行，验证分页渲染规模与真实拖动路径
    const load = JSON.parse(JSON.stringify(panel.load));
    for (let i = 0; i < 120; i++) load.model.items.push({ type: 'row', row: { fields: ['NPC' + i, '0', String(i), String(i), 'NPC名称' + i, '0', '0', '0'] } });
    win.postMessage(load, '*');
    await new Promise((resolve) => setTimeout(resolve, 50));
    ok(doc.querySelectorAll('tbody tr').length === 100, '123 行数据首页只渲染 100 个条目');
    ok(doc.querySelectorAll('tbody td.cell-view').length === 99 * 15, '每页只读单元格 99 数据行×15 列（编辑器按需创建）');
    ok(doc.querySelectorAll('tr.raw-row').length === 1, '注释行以只读行显示（1 条 // 行）');
    ok(doc.getElementById('pageInfo').textContent === '1/2 页', '分页信息 1/2 页');
    ok(doc.getElementById('rowCount').textContent === '123 / 123 条记录', '记录总数统计正确');
    ok(doc.getElementById('sourceBadge').textContent === 'XLS', '来源徽章显示 XLS');

    const col0 = () => doc.querySelector('col[data-column="0"]');
    const grip = () => doc.querySelector('.col-resizer');
    const widthBefore = parseInt(col0().style.width, 10);

    grip().dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 160 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 160 }));
    ok(parseInt(col0().style.width, 10) === widthBefore + 60, '指针拖动把手 +60 列宽生效');
    ok(state.merchColumnWidths[0] === widthBefore + 60 && Boolean(state.merchManualColumnWidths[0]), '拖后列宽与手动标记持久化');
    ok(doc.querySelector('thead tr th:nth-child(2)').style.width === (widthBefore + 60) + 'px', '同步写入表头单元格宽度');
    const tableWidth = () => parseInt(doc.querySelector('#tableWrap table').style.width, 10);
    const tableWidthBefore = tableWidth();
    grip().dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 130 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 130 }));
    ok(tableWidth() === tableWidthBefore + 30, '拖动同步更新表格总宽（分配基准）');

    grip().dispatchEvent(new win.MouseEvent('dblclick', { clientX: 100, bubbles: true }));
    ok(parseInt(col0().style.width, 10) === widthBefore && !state.merchManualColumnWidths[0], '双击把手恢复自适应列宽');

    const search = doc.getElementById('searchInput');
    search.value = '老兵';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(doc.querySelectorAll('tbody tr').length === 1, '筛选后只剩 1 行并回到第 1 页');

    search.value = '';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.getElementById('nextPage').click();
    ok(doc.querySelectorAll('tbody tr').length === 24 && doc.querySelector('tbody tr td.row-no').textContent === '100', '第 2 页渲染剩余 24 个条目且行号连续');

    doc.getElementById('prevPage').click();
    const scriptBtn = doc.querySelector('.op-btn');
    scriptBtn.click();
    const openMsg = postedByWebview.find((m) => m.type === 'openScript');
    ok(openMsg && openMsg.name === '中州\\老兵' && openMsg.map === '0', '行内「脚本」按钮发送打开脚本消息');

    // 右键注释 / 取消注释
    const dataTr = doc.querySelector('tbody tr:not(.raw-row)');
    const rowIdx = dataTr.dataset.idx;
    dataTr.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    ok(doc.getElementById('ctxMenu').style.display === 'block', '右键数据行弹出菜单');
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent === '注释该行').click();
    ok(win.eval('MODEL.items[' + rowIdx + '].type') === 'raw', '注释该行后转为注释行');
    ok(String(win.eval('MODEL.items[' + rowIdx + '].text')).indexOf('// ') === 0, '注释行以 // 前缀序列化字段');
    ok(doc.querySelectorAll('tr.raw-row').length === 2, '注释行显示数量 +1');
    const rawTr = Array.from(doc.querySelectorAll('tr.raw-row')).find((t) => t.textContent.indexOf('中州') >= 0);
    rawTr.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent === '取消注释').click();
    ok(win.eval('MODEL.items[' + rowIdx + '].type') === 'row', '取消注释恢复为数据行');
    ok(win.eval('MODEL.items[' + rowIdx + '].row.fields[4]') === '老兵', '取消注释后字段完整');

    // Ctrl+Z 撤销 / 重做（双击进入编辑，失焦提交）
    const editTd = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="4"]');
    const editIdx = editTd.dataset.idx;
    editTd.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
    const editInput = editTd.querySelector('input');
    ok(Boolean(editInput), '双击单元格进入编辑');
    editInput.value = '撤销测试名';
    editInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    editInput.dispatchEvent(new win.Event('blur'));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[4]') === '撤销测试名', '失焦提交编辑');
    const tdAgain = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="6"]');
    tdAgain.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    tdAgain.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    ok(Boolean(tdAgain.querySelector('input')), '连续两次单击同一单元格进入编辑');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[4]') === '老兵', 'Ctrl+Z 撤销恢复原值');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[4]') === '撤销测试名', 'Ctrl+Shift+Z 重做恢复新值');

    // 单元格选区变量（供后续选区/复制粘贴测试使用）
    const dataRows = doc.querySelectorAll('tbody tr:not(.raw-row)');
    const selIdx1 = dataRows[0].dataset.idx;
    const selIdx2 = dataRows[1].dataset.idx;
    // 单元格范围选择（jsdom 无布局，拖动范围直接赋值验证渲染）
    const cellTd = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="4"]');
    cellTd.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { bubbles: true }));
    ok(doc.querySelectorAll('td.cell-selected').length === 1, '单击单元格仅选中一个单元格');
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 4, bIdx: ' + selIdx2 + ', bCol: 6 }; renderTable()');
    ok(doc.querySelectorAll('td.cell-selected').length === 2 * 3, '单元格矩形范围高亮 2 行×3 列');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.querySelectorAll('td.cell-selected').length === 0, 'Esc 清除单元格选择');

    // Ctrl+C 复制单元格 / Ctrl+V 填充多选单元格
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 4, bIdx: ' + selIdx1 + ', bCol: 4 }; renderTable()');
    const srcVal = win.eval('MODEL.items[' + selIdx1 + '].row.fields[4]');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('clipText') === srcVal, 'Ctrl+C 复制当前单元格值');
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 4, bIdx: ' + selIdx2 + ', bCol: 4 }; renderTable()');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx2 + '].row.fields[4]') === srcVal, 'Ctrl+V 将值填充进多选单元格');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx2 + '].row.fields[4]') !== srcVal, '粘贴可一步撤销');

    // 多列数据粘贴到单个单元格：锚点向后自动填充，不超最大列（merchant 最大列下标 14）
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 13, bIdx: ' + selIdx1 + ', bCol: 13 }; renderTable()');
    win.eval('clipText = "A	B	C"');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx1 + '].row.fields[13]') === 'A' && win.eval('MODEL.items[' + selIdx1 + '].row.fields[14]') === 'B', '锚点向后填充两列');
    ok(win.eval('MODEL.items[' + selIdx1 + '].row.fields.length') <= 15, '不超最大列（第三值被截断）');
    ok(win.eval('cellSel.bCol') === 14, '选区高亮实际填充范围');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));

    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(Boolean(postedByWebview.find((m) => m.type === 'save')), 'Ctrl+S 发送保存消息');

    const tdExit = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="6"]');
    const exitIdx = tdExit.dataset.idx;
    tdExit.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
    const exitInput = tdExit.querySelector('input');
    exitInput.value = '点击他处退出';
    exitInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="8"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { bubbles: true }));
    ok(!tdExit.querySelector('input'), '点击其他单元格退出编辑模式');
    ok(win.eval('MODEL.items[' + exitIdx + '].row.fields[6]') === '点击他处退出', '退出编辑时提交修改');
  } finally {
    win.close();
  }
}

testPanelPrefersXls()
  .then((panel) => testWebviewTable(panel))
  .then(() => {
    console.log('\n全部通过: ' + passed + ' 项');
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
