/** MonGen.txt 解析与序列化 round-trip 测试（直接加载编译产物，无需 vscode） */
const assert = require('assert');
const {
  parseMonGen, serializeMonGen, monGenRows, rowField, setRowField, MON_GEN_COLUMNS, monGenNeedsAlignment,
} = require('../out/mapeditor/monGenModel');

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log('  ✓ ' + label);
}

const sample = [
  ';地图\t坐标X\t坐标Y\t怪物名称\t范围\t数量\t间隔\t集中\t死了才刷\t新名字',
  '',
  '*L006\t12\t27\t测试怪甲\t10\t1\t5\t0\t1\t坟头一\t0\t1\t2\t3\t@刷出怪来\t0\t1\t301\t301\t0\t0\t0\t1',
  '//TEST 25 25 注释怪 10 1 5',
  '0 330 330 鹿 5 10 10',
  '0 331 330 稻草人 5 5 10',
  '坏行',
].join('\r\n');

console.log('MonGen round-trip:');
const model = parseMonGen(sample);
const rows = monGenRows(model);
ok(rows.length === 3, '解析出 3 条刷怪记录，双斜线行不计入');
ok(rows[0].fields.length === 23, '新格式 23 列');
ok(rowField(rows[0], 0) === '*L006' && rowField(rows[0], 3) === '测试怪甲', '地图/怪物名');
ok(rowField(rows[0], 14) === '@刷出怪来', '触发标签列');
ok(rowField(rows[0], 22) === '1', '墓碑刷新方式列');
ok(rows[1].fields.length === 7, '旧格式 7 列兼容');
ok(rowField(rows[1], 22) === '', '越界列返回空串');

setRowField(rows[1], 7, '80');
ok(rows[1].fields.length === 8 && rowField(rows[1], 7) === '80', 'setRowField 连续列扩展');

const text1 = serializeMonGen(model);
const text2 = serializeMonGen(parseMonGen(text1));
ok(text1 === text2, '序列化幂等');
ok(text1.startsWith(';地图'), '注释保留');
ok(text1.includes('//TEST 25 25 注释怪 10 1 5'), '双斜线注释行原样保留');
ok(text1.includes('坏行'), '坏行保留');
ok(text1.endsWith('\r\n'), '文件末尾换行');
ok(!/\t| {2}/.test(text1.split('\r\n').filter((l) => l && !l.startsWith(';')).join('\n')), '输出为单空格分隔');
ok(MON_GEN_COLUMNS.length === 23, '列定义 23 条');

// 空字段占位符 ;：解析保留列位，序列化中间空列写回 ;，行尾空列丢弃
const m2 = parseMonGen('0\t1\t2\t鹿\t5\t10\t10\t0\t0\t\t30');
ok(monGenRows(m2)[0].fields.length === 11 && rowField(monGenRows(m2)[0], 9) === '', 'Tab 行解析保留空列位');
ok(serializeMonGen(m2).includes('0 1 2 鹿 5 10 10 0 0 ; 30'), '中间空列写回 ; 占位');
const m3 = parseMonGen('0 1 2 鹿 5 10 10 ; ; ; 30');
ok(serializeMonGen(m3).includes('0 1 2 鹿 5 10 10 ; ; ; 30'), '; 占位列位不变');
const m4 = parseMonGen('0 1 2 鹿 5 10 10 ; ;');
ok(serializeMonGen(m4).includes('0 1 2 鹿 5 10 10\r\n'), '行尾空列/占位丢弃');

console.log('智能刷怪(*):');
const { parseMapField, buildMapField } = require('../out/mapeditor/monGenModel');
ok(parseMapField('*L006').smart === true && parseMapField('*L006').id === 'L006', '* 前缀识别为智能');
ok(parseMapField('L006').smart === false && parseMapField('L006').id === 'L006', '普通地图号');
ok(buildMapField('L006', true) === '*L006' && buildMapField('L006', false) === 'L006', '构建地图字段');
ok(monGenRows(parseMonGen('*L006 12 27 鹿 5 10 10'))[0].fields[0] === '*L006', '解析保留 * 前缀');
ok(serializeMonGen(parseMonGen('*L006 12 27 鹿 5 10 10')).includes('*L006 12 27 鹿 5 10 10'), '序列化保留 * 前缀');

console.log('对齐检测:');
ok(monGenNeedsAlignment('0\t330\t330\t鹿\t5\t10\t10'), '含 TAB 需对齐');
ok(monGenNeedsAlignment('0  330 330 鹿 5 10 10'), '含多空格需对齐');
ok(!monGenNeedsAlignment('0 330 330 鹿 5 10 10'), '单空格无需对齐');
ok(!monGenNeedsAlignment(';注释\t含\tTAB 不检测'), '注释行不检测');
ok(!monGenNeedsAlignment('；全角分号注释  也不检测'), '全角分号注释');
ok(!monGenNeedsAlignment('//TEST\t25\t25\t注释怪\t10\t1\t5'), '双斜线注释不检测对齐');

console.log('XLS 读取与写回:');
const XLSX = require('xlsx');
const { parseMonGenWorkbook, serializeMonGenWorkbook } = require('../out/mapeditor/monGenXls');
const wb = XLSX.utils.book_new();
const header = ['地图', '坐标X', '坐标Y', '怪物名字', '范围', '数量', '间隔(分钟)', '集中刷新机率', '死了才刷', '重命名', '怪物等级'];
const sheet = XLSX.utils.aoa_to_sheet([
  header,
  ['//TEST', 25, 25, '注释怪', 10, 1, 5],
  ['*L006', 12, 27, '测试怪甲', 10, 1, 5, 0, 1, '坟头一', 30],
  ['0', 330, 330, '鹿', 5, 10, 10, 0, 0, '', 30],
  ['0', 331, 330, '稻草人', 5, 5, 10],
]);
sheet.A4.z = ';;;';
XLSX.utils.book_append_sheet(wb, sheet, 'MonGen');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['此工作表必须保留']]), '说明');
const xlsBytes = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
const parsedXls = parseMonGenWorkbook(xlsBytes);
const xlsRows = monGenRows(parsedXls.model);
ok(parsedXls.sheetName === 'MonGen', '选中包含刷怪记录的工作表');
ok(xlsRows.length === 3, 'XLS 解析出 3 条刷怪记录，双斜线行不计入');
ok(parsedXls.model.items[0].type === 'raw', 'XLS 中文表头不作为怪物记录');
ok(parsedXls.model.items[1].type === 'raw' && parsedXls.model.items[1].text.startsWith('//TEST\t'), 'XLS 双斜线注释原样保留');
ok(rowField(xlsRows[0], 0) === '*L006' && rowField(xlsRows[0], 3) === '测试怪甲', 'XLS 中文与智能刷怪前缀');
ok(rowField(xlsRows[1], 0) === '0', '隐藏自定义格式单元格仍读取原始地图值');
ok(xlsRows[1].fields.length === 11 && rowField(xlsRows[1], 9) === '' && rowField(xlsRows[1], 10) === '30', 'XLS 中间空列位置不变');
ok(xlsRows[2].fields.length === 7, 'XLS 旧格式 7 列兼容');
setRowField(xlsRows[1], 9, '新鹿王');
const writtenXls = serializeMonGenWorkbook(parsedXls.model, parsedXls.workbook, parsedXls.sheetName);
ok(writtenXls[0] === 0xD0 && writtenXls[1] === 0xCF && writtenXls[2] === 0x11 && writtenXls[3] === 0xE0, '写回真实 XLS（BIFF）文件');
const reparsedXls = parseMonGenWorkbook(writtenXls);
ok(rowField(monGenRows(reparsedXls.model)[1], 9) === '新鹿王', 'XLS 修改后重新读取生效');
ok(reparsedXls.model.items[0].type === 'raw' && reparsedXls.model.items[0].text.split('\t')[0] === '地图', 'XLS 写回保留表头');
ok(reparsedXls.workbook.SheetNames.includes('说明'), 'XLS 写回保留其他工作表');
const otherSheetRows = XLSX.utils.sheet_to_json(reparsedXls.workbook.Sheets['说明'], { header: 1 });
ok(otherSheetRows[0][0] === '此工作表必须保留', '其他工作表内容不变');

async function testPanelPrefersXls() {
  console.log('管理器 Data/mongen.xls 优先级:');
  const nodePath = require('path');
  const iconv = require('iconv-lite');
  const Module = require('module');
  const origLoad = Module._load;
  const root = nodePath.join('D:', 'server', 'Envir');
  const txtPath = nodePath.join(root, 'MonGen.txt');
  const xlsPath = nodePath.join(root, 'Data', 'mongen.xls');
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
          if (base === 'data') return [['mongen.xls', 1]];
          throw new Error('not found');
        },
        readFile: async (uri) => {
          if (uri.fsPath.toLowerCase() === xlsPath.toLowerCase()) return xlsBytes;
          if (uri.fsPath.toLowerCase() === txtPath.toLowerCase()) {
            return iconv.encode('0 1 2 TXT怪 5 10 10', 'gbk');
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
  let MonGenPanel, MonGenCustomEditorProvider, isMonGenFile;
  try {
    MonGenPanel = require('../out/mapeditor/monGenPanel').MonGenPanel;
    MonGenCustomEditorProvider = require('../out/mapeditor/monGenCustomEditor').MonGenCustomEditorProvider;
    isMonGenFile = require('../out/mapeditor/mapManagerPanel').isMonGenFile;
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
  MonGenPanel.show({ extensionPath: root, subscriptions: [] }, makeUri(txtPath));
  const scriptMatch = fakePanel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  ok(Boolean(scriptMatch), '表格界面包含 Webview 脚本');
  new Function(scriptMatch[1]);
  ok(true, '表格 Webview 脚本语法有效');
  const load = await waitFor(() => posted.find((msg) => msg.type === 'load'));
  ok(load.sourceKind === 'xls' && load.filePath.toLowerCase() === xlsPath.toLowerCase(), '同时存在时优先加载 Data/mongen.xls');
  ok(monGenRows(load.model)[0] && rowField(monGenRows(load.model)[0], 3) === '测试怪甲', '管理器未错误读取 TXT 内容');
  const edited = JSON.parse(JSON.stringify(load.model));
  setRowField(monGenRows(edited)[0], 3, 'XLS已修改');
  messageHandler({ type: 'save', model: edited });
  await waitFor(() => posted.find((msg) => msg.type === 'saveResult' && msg.ok));
  ok(writes.length === 1 && writes[0].fsPath.toLowerCase() === xlsPath.toLowerCase(), '保存写回 XLS 而非 TXT');
  ok(rowField(monGenRows(parseMonGenWorkbook(writes[0].bytes).model)[0], 3) === 'XLS已修改', '管理器保存的 XLS 可重新读取');

  console.log('直接打开 MonGen.xls:');
  ok(isMonGenFile(xlsPath) && isMonGenFile(txtPath), '文件识别同时支持 MonGen.xls 与 MonGen.txt');
  const customEditor = require('../package.json').contributes.customEditors
    .find((editor) => editor.viewType === 'm2script.monGenXls');
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
  const provider = new MonGenCustomEditorProvider({ extensionPath: root, subscriptions: [] });
  const document = provider.openCustomDocument(makeUri(xlsPath));
  provider.resolveCustomEditor(document, directPanel);
  const directLoad = await waitFor(() => directPosted.find((msg) => msg.type === 'load'));
  ok(directPanel.webview.options.enableScripts === true, '直接打开时启用表格 Webview 脚本');
  ok(directLoad.sourceKind === 'xls' && directLoad.filePath.toLowerCase() === xlsPath.toLowerCase(), '直接打开 XLS 时读取文件自身');
  ok(rowField(monGenRows(directLoad.model)[0], 3) === '测试怪甲', '直接打开 XLS 显示正确怪物数据');
  return { html: fakePanel.webview.html, load };
}

/** 用 jsdom 在 Node 中真实运行 Webview 脚本，模拟指针拖动与分页验证（无需浏览器） */
async function testWebviewColumnResize(panel) {
  console.log('表格列宽拖动与分页 (jsdom 模拟):');
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
    for (let i = 0; i < 120; i++) load.model.items.push({ type: 'row', row: { fields: ['0', String(i), String(i), '怪' + i, '5', '1', '10'] } });
    win.postMessage(load, '*');
    await new Promise((resolve) => setTimeout(resolve, 50));
    ok(doc.querySelectorAll('tbody tr').length === 100, '123 行数据首页只渲染 100 个条目');
    ok(doc.querySelectorAll('tbody td.cell-view').length === 99 * 23, '每页只读单元格 99 数据行×23 列（编辑器按需创建）');
    ok(doc.querySelectorAll('tr.raw-row').length === 1, '注释行以只读行显示（1 条 // 行）');
    ok(doc.getElementById('pageInfo').textContent === '1/2 页', '分页信息 1/2 页');
    ok(doc.getElementById('rowCount').textContent === '123 / 123 条记录', '记录总数统计正确');

    const col0 = () => doc.querySelector('col[data-column="0"]');
    const grip = () => doc.querySelector('.col-resizer');
    ok(parseInt(col0().style.width, 10) === 64, '首列初始自适应列宽 64');

    grip().dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 160 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 160 }));
    ok(parseInt(col0().style.width, 10) === 124, '指针拖动把手 +60 后列宽 64→124');
    ok(state.genColumnWidths[0] === 124 && Boolean(state.genManualColumnWidths[0]), '拖后列宽与手动标记持久化');
    ok(doc.querySelector('thead tr th:nth-child(3)').style.width === '124px', '同步写入表头单元格宽度');
    ok(doc.querySelector('tbody tr:not(.raw-row) td:nth-child(3)').style.width === '124px', '同步写入首行数据单元格宽度');
    const tableWidth = () => parseInt(doc.querySelector('#tableWrap table').style.width, 10);
    const widthBeforeDrag = tableWidth();
    grip().dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 190 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 190 }));
    ok(tableWidth() === widthBeforeDrag + 90, '拖动同步更新表格总宽（分配基准）');

    const search = doc.getElementById('searchInput');
    search.value = '鹿';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(doc.querySelectorAll('tbody tr').length === 1, '筛选后只剩 1 行并回到第 1 页');
    ok(parseInt(col0().style.width, 10) === 214, '筛选重渲染后保持手动列宽');

    grip().dispatchEvent(new win.MouseEvent('dblclick', { clientX: 100, bubbles: true }));
    ok(parseInt(col0().style.width, 10) === 64 && !state.genManualColumnWidths[0], '双击把手恢复自适应列宽');

    search.value = '';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.getElementById('nextPage').click();
    ok(doc.querySelectorAll('tbody tr').length === 24, '第 2 页渲染剩余 24 个条目');
    ok(doc.querySelector('tbody tr td.row-no').textContent === '100', '第 2 页数据行号从 100 连续编号');
    ok(doc.getElementById('pageInfo').textContent === '2/2 页', '分页信息 2/2 页');

    // 表头右缘兜底（jsdom 无布局 rect=0，clientX=0 视为右缘）
    const th = grip().closest('th');
    th.dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 0, bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 80 }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 80 }));
    ok(parseInt(col0().style.width, 10) === 144, '表头右缘兜底热区拖动 64→144');

    // 右键注释 / 取消注释
    doc.getElementById('prevPage').click();
    const dataTr = doc.querySelector('tbody tr:not(.raw-row)');
    const rowIdx = dataTr.dataset.idx;
    dataTr.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    ok(doc.getElementById('ctxMenu').style.display === 'block', '右键数据行弹出菜单');
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent === '注释该行').click();
    ok(win.eval('MODEL.items[' + rowIdx + '].type') === 'raw', '注释该行后转为注释行');
    ok(String(win.eval('MODEL.items[' + rowIdx + '].text')).indexOf('// ') === 0, '注释行以 // 前缀序列化字段');
    ok(doc.querySelectorAll('tr.raw-row').length === 2, '注释行显示数量 +1');
    const rawTr = Array.from(doc.querySelectorAll('tr.raw-row')).find((t) => t.textContent.indexOf('*L006') >= 0);
    rawTr.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    Array.from(doc.querySelectorAll('.ctx-item')).find((d) => d.textContent === '取消注释').click();
    ok(win.eval('MODEL.items[' + rowIdx + '].type') === 'row', '取消注释恢复为数据行');
    ok(win.eval('MODEL.items[' + rowIdx + '].row.fields[3]') === '测试怪甲', '取消注释后字段完整');

    // Ctrl+Z 撤销 / 重做（双击进入编辑，失焦提交）
    const editTd = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="3"]');
    const editIdx = editTd.dataset.idx;
    editTd.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
    const editInput = editTd.querySelector('input');
    ok(Boolean(editInput), '双击单元格进入编辑');
    editInput.value = '撤销测试名';
    editInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    editInput.dispatchEvent(new win.Event('blur'));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[3]') === '撤销测试名', '失焦提交编辑');
    const tdAgain = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="9"]');
    tdAgain.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    tdAgain.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    ok(Boolean(tdAgain.querySelector('input')), '连续两次单击同一单元格进入编辑');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[3]') === '测试怪甲', 'Ctrl+Z 撤销恢复原值');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + editIdx + '].row.fields[3]') === '撤销测试名', 'Ctrl+Shift+Z 重做恢复新值');

    // 单元格选区变量（供后续选区/复制粘贴测试使用）
    const dataRows = doc.querySelectorAll('tbody tr:not(.raw-row)');
    const selIdx1 = dataRows[0].dataset.idx;
    const selIdx2 = dataRows[1].dataset.idx;
    // 单元格范围选择（jsdom 无布局，拖动范围直接赋值验证渲染）
    const cellTd = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="3"]');
    cellTd.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { bubbles: true }));
    ok(doc.querySelectorAll('td.cell-selected').length === 1, '单击单元格仅选中一个单元格');
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 3, bIdx: ' + selIdx2 + ', bCol: 5 }; renderTable()');
    ok(doc.querySelectorAll('td.cell-selected').length === 2 * 3, '单元格矩形范围高亮 2 行×3 列');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.querySelectorAll('td.cell-selected').length === 0, 'Esc 清除单元格选择');

    // Ctrl+C 复制单元格 / Ctrl+V 填充多选单元格
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 3, bIdx: ' + selIdx1 + ', bCol: 3 }; renderTable()');
    const srcVal = win.eval('MODEL.items[' + selIdx1 + '].row.fields[3]');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('clipText') === srcVal, 'Ctrl+C 复制当前单元格值');
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 3, bIdx: ' + selIdx2 + ', bCol: 3 }; renderTable()');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx2 + '].row.fields[3]') === srcVal, 'Ctrl+V 将值填充进多选单元格');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx2 + '].row.fields[3]') !== srcVal, '粘贴可一步撤销');

    // 多列数据粘贴到单个单元格：锚点向后自动填充，不超最大列（monGen 最大列下标 22）
    win.eval('cellSel = { aIdx: ' + selIdx1 + ', aCol: 21, bIdx: ' + selIdx1 + ', bCol: 21 }; renderTable()');
    win.eval('clipText = "A	B	C"');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(win.eval('MODEL.items[' + selIdx1 + '].row.fields[21]') === 'A' && win.eval('MODEL.items[' + selIdx1 + '].row.fields[22]') === 'B', '锚点向后填充两列');
    ok(win.eval('MODEL.items[' + selIdx1 + '].row.fields.length') <= 23, '不超最大列（第三值被截断）');
    ok(win.eval('cellSel.bCol') === 22, '选区高亮实际填充范围');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));

    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    ok(Boolean(postedByWebview.find((m) => m.type === 'save')), 'Ctrl+S 发送保存消息');

    const tdExit = doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="5"]');
    const exitIdx = tdExit.dataset.idx;
    tdExit.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
    const exitInput = tdExit.querySelector('input');
    exitInput.value = '点击他处退出';
    exitInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('tbody tr:not(.raw-row) td.cell-view[data-col="7"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    win.dispatchEvent(new win.MouseEvent('pointerup', { bubbles: true }));
    ok(!tdExit.querySelector('input'), '点击其他单元格退出编辑模式');
    ok(win.eval('MODEL.items[' + exitIdx + '].row.fields[5]') === '点击他处退出', '退出编辑时提交修改');
  } finally {
    win.close();
  }
}

testPanelPrefersXls()
  .then((panel) => testWebviewColumnResize(panel))
  .then(() => {
    console.log('\n全部通过: ' + passed + ' 项');
  }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
