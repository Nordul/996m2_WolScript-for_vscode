/* 用 mock vscode API 在 Node 中直接测试补全 Provider: node scripts/completiontest.js */
const Module = require('module');
const path = require('path');

// ---- vscode mock ----
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; }
    else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
}
class Selection extends Range {}
class SnippetString { constructor(v) { this.value = v; } }
class MarkdownString {
  constructor() { this.value = ''; }
  appendCodeblock(v) { this.value += v; return this; }
  appendMarkdown(v) { this.value += v; return this; }
}
class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}
class FoldingRange {
  constructor(start, end, kind) { this.start = start; this.end = end; this.kind = kind; }
}
class Color {
  constructor(red, green, blue, alpha) { this.red = red; this.green = green; this.blue = blue; this.alpha = alpha; }
}
class ColorInformation {
  constructor(range, color) { this.range = range; this.color = color; }
}
class Location {
  constructor(uri, rangeOrPosition) { this.uri = uri; this.range = rangeOrPosition; }
}
class CodeLens {
  constructor(range, command) { this.range = range; this.command = command; }
}
class ColorPresentation {
  constructor(label) { this.label = label; }
}
const vscodeMock = {
  Position, Range, Selection, SnippetString, MarkdownString, CompletionItem, FoldingRange, Location, CodeLens,
  Color, ColorInformation, ColorPresentation,
  FoldingRangeKind: { Region: 3 },
  CompletionItemKind: {
    Function: 2, Variable: 4, Class: 5, Property: 9, Keyword: 13, Snippet: 14,
    Reference: 17, Operator: 11, Event: 22, EnumMember: 19,
  },
  TextEditorRevealType: { InCenter: 1 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  Uri: { file: (f) => ({ fsPath: f, scheme: 'file' }) },
  languages: {
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
    registerDefinitionProvider: () => ({ dispose() {} }),
    registerFoldingRangeProvider: () => ({ dispose() {} }),
    registerColorProvider: () => ({ dispose() {} }),
    registerReferenceProvider: () => ({ dispose() {} }),
    registerCodeLensProvider: () => ({ dispose() {} }),
    setTextDocumentLanguage: async () => undefined,
  },
  window: {
    registerWebviewViewProvider: () => ({ dispose() {} }),
    showTextDocument: async () => ({ selection: null, revealRange() {} }),
    activeTextEditor: undefined,
    createTextEditorDecorationType: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    withProgress: async (opts, task) => task({ report() {} }, {}),
  },
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: { fsPath: 'D:\\test' } }],
    asRelativePath: (u) => u.fsPath,
    findFiles: async () => [],
    openTextDocument: async (u) => { const d = makeDoc(require('fs').readFileSync(u.fsPath, 'utf8')); d.uri = u; return d; },
    fs: { readFile: async () => new Uint8Array() },
    onDidOpenTextDocument: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
  debug: {
    registerDebugConfigurationProvider: () => ({ dispose() {} }),
    registerDebugAdapterDescriptorFactory: () => ({ dispose() {} }),
  },
  DebugAdapterInlineImplementation: class {},
  EventEmitter: class {
    event = () => {};
    fire() {}
    dispose() {}
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return 'vscode-mock';
  return origResolve.call(this, request, ...args);
};
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...args);
};

// ---- 假文档 ----
function makeDoc(text) {
  const lines = text.split('\n');
  return {
    languageId: 'm2script',
    uri: { fsPath: 'D:\\test\\QuestDiary\\demo.txt', scheme: 'file' },
    fileName: 'D:\\test\\QuestDiary\\demo.txt',
    lineCount: lines.length,
    lineAt: (i) => ({ text: lines[i] }),
    getText: () => text,
  };
}

const doc = makeDoc(`[@main]
#IF

#ACT

#SAY

`);

const provider = new (require('../out/providers/completion').M2CompletionProvider)();

let fail = 0;
function test(name, target, line, ch, expectSome, sampleCheck) {
  try {
    const items = provider.provideCompletionItems(target, new Position(line, ch));
    const n = items ? items.length : 0;
    let ok = expectSome ? n > 0 : true;
    let extra = '';
    if (ok && sampleCheck && items) {
      extra = sampleCheck(items);
      if (extra) ok = false;
    }
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${n} 项 ${extra}`);
    if (items && n) console.log('   前3项:', items.slice(0, 3).map((i) => `${i.label} => ${JSON.stringify(i.insertText && i.insertText.value !== undefined ? i.insertText.value : i.insertText)}`).join(' | '));
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: 异常 ${e.message}`);
  }
}

// #IF 段空行(行2): 应只出检测命令
test('#IF段命令补全', doc, 2, 0, true, (items) => {
  const hasCheck = items.some((i) => i.label === 'CHECKITEM');
  const hasAction = items.some((i) => i.label === 'MOV');
  return !hasCheck ? '缺CHECKITEM' : (hasAction ? '不应含MOV' : '');
});
// #ACT 段空行(行4): 应只出执行命令
test('#ACT段命令补全', doc, 4, 0, true, (items) => {
  const hasAction = items.some((i) => i.label === 'MOV');
  const hasCheck = items.some((i) => i.label === 'CHECKITEM');
  return !hasAction ? '缺MOV' : (hasCheck ? '不应含CHECKITEM' : '');
});
// #SAY 段(行6)
test('#SAY段补全', doc, 6, 0, true);
// < 触发
doc2Lines: {
}
const doc2 = makeDoc('[@main]\n#ACT\nMov s$Ui <\nMov A0 <\nMov A0 <$\nMov A0 $STR(\nGOTO @\n#\nMov A0 <$USER\nMO\nMov s$Ui <RT\nGOTO @ma\nMov s$Ui <RText|x=1|t\nSENDMSG \nSENDMSG 2\n#C\nMov A0 <$CUST\nMov A0 <$HUM\nSETS\n');
test('< 触发组件', doc2, 2, 10, true, (items) => items.some((i) => i.label === 'Button') ? '' : '缺Button');
test('<$ 触发系统变量', doc2, 4, 10, true, (items) => {
  const u = items.find((i) => i.label === '$USERNAME');
  return !u ? '缺$USERNAME' : (u.insertText && String(u.insertText.value).endsWith('>') ? '' : 'insertText未带>');
});
test('$STR( 内变量类型', doc2, 5, 12, true);
test('@ 触发标签', doc2, 6, 6, true, (items) => items.some((i) => i.label === 'main') ? '' : '缺标签main');
test('# 触发段标记', doc2, 7, 1, true);

// 已输入字符过滤: 列表必须按前缀收窄, 而不是全量 A-Z
test('<$USER 前缀过滤', doc2, 8, 13, true, (items) => {
  const bad = items.filter((i) => !String(i.label).toUpperCase().startsWith('$USER'));
  const u = items.find((i) => i.label === '$USERNAME');
  return bad.length ? `含非USER前缀项:${bad[0].label}` : (!u ? '缺$USERNAME' : (!u.range ? '缺range' : ''));
});
test('MO 命令前缀过滤', doc2, 9, 2, true, (items) => {
  const bad = items.filter((i) => !String(i.label).toUpperCase().startsWith('MO'));
  return bad.length ? `含非MO前缀项:${bad[0].label}` : '';
});
test('<RT 组件前缀过滤', doc2, 10, 12, true, (items) => {
  if (!items.some((i) => i.label === 'RText')) return '缺RText';
  return items.some((i) => i.label === 'Button') ? 'Button不应出现' : '';
});
test('@ma 标签前缀过滤', doc2, 11, 9, true, (items) => {
  const bad = items.filter((i) => !String(i.label).toLowerCase().includes('ma'));
  return bad.length ? `含不匹配项:${bad[0].label}` : '';
});
test('组件参数前缀过滤', doc2, 12, 21, true, (items) => {
  const bad = items.filter((i) => !String(i.label).toLowerCase().startsWith('t'));
  return bad.length ? `含非t前缀参数:${bad[0].label}` : '';
});

// 带参变量形态: <$CUSTOMVALUE(A)> / <$HUMANINFO[A].B> 需给出参数占位符
test('<$CUST 带参变量补全', doc2, 16, 13, true, (items) => {
  const c = items.find((i) => i.label === '$CUSTOMVALUE');
  if (!c) return '缺$CUSTOMVALUE';
  const v = String(c.insertText && c.insertText.value);
  return v === '\\$CUSTOMVALUE(${1:A}$0)>' ? '' : 'insertText应为<$CUSTOMVALUE(A)>形态: ' + JSON.stringify(v);
});
test('<$HUM 方括号变量补全', doc2, 17, 12, true, (items) => {
  const h = items.find((i) => i.label === '$HUMANINFO');
  if (!h) return '缺$HUMANINFO';
  const v = String(h.insertText && h.insertText.value);
  return v === '\\$HUMANINFO[${1:A}].${2:B}$0>' ? '' : 'insertText应为<$HUMANINFO[A].B>形态: ' + JSON.stringify(v);
});
// 标题签名命令: SetStrValue 需在 #ACT 段命令补全中出现
test('SETS 命令前缀过滤', doc2, 18, 4, true, (items) =>
  items.some((i) => i.label.toUpperCase() === 'SETSTRVALUE') ? '' : '缺SETSTRVALUE');

// 已有闭合符时不重复插入: range 应吞掉旧的 > / (参数)> / [参数].B>
const doc3 = makeDoc('[@main]\n#ACT\nMov A0 <$USEITEMMAKEINDEX(1)>\nMov A0 <$USER>\nMov A0 <$HUMANINFO[$USERNAME].$X>\nMov s$Ui <Tex>\n');
test('补全吞掉已有(参数)>', doc3, 2, 25, true, (items) => {
  const c = items.find((i) => i.label === '$USEITEMMAKEINDEX');
  if (!c) return '缺$USEITEMMAKEINDEX';
  return c.range && c.range.end.character === 29 ? '' : 'range.end应为29, 实际 ' + (c.range && c.range.end.character);
});
test('补全吞掉已有>', doc3, 3, 13, true, (items) => {
  const u = items.find((i) => i.label === '$USERNAME');
  if (!u) return '缺$USERNAME';
  return u.range && u.range.end.character === 14 ? '' : 'range.end应为14, 实际 ' + (u.range && u.range.end.character);
});
test('补全吞掉已有[参数].B>', doc3, 4, 18, true, (items) => {
  const h = items.find((i) => i.label === '$HUMANINFO');
  if (!h) return '缺$HUMANINFO';
  return h.range && h.range.end.character === 33 ? '' : 'range.end应为33, 实际 ' + (h.range && h.range.end.character);
});
test('组件补全吞掉已有>', doc3, 5, 13, true, (items) => {
  const t = items.find((i) => i.label === 'Text');
  if (!t) return '缺Text';
  return t.range && t.range.end.character === 14 ? '' : 'range.end应为14, 实际 ' + (t.range && t.range.end.character);
});

// @ 标签补全: UI 组件属性值内(link=@)也要提示标签; 含 - 的标签名可连续输入
test('link=@ 内标签补全', makeDoc('[@main]\n#ACT\nMov s$Ui <Button|x=1|link=@\n'), 2, 27, true, (items) =>
  items.some((i) => i.label === 'main') ? '' : '缺标签main');
test('含-标签连续输入', makeDoc('[@技能-修炼]\n#ACT\nGOTO @技能-\n'), 2, 10, true, (items) =>
  items.some((i) => i.label === '技能-修炼') ? '' : '缺标签"技能-修炼"');

// 标签引用统计 / 引用跳转 / CodeLens
try {
  const { collectReferences, M2ReferenceProvider, M2LabelCodeLensProvider } = require('../out/providers/references');
  const rdoc = makeDoc('[@main]\n#ACT\nGOTO @战斗\nQueryMsg 继续吗 @确认\n\n[@战斗]\n#ACT\nMov s$Ui <Button|link=@战斗>\n\n[@确认1]\n#ACT\nBREAK');
  const refs = collectReferences(rdoc);
  let ok = refs.get('战斗').length === 2          // GOTO + link=
    && refs.get('确认1').length === 1            // QueryMsg @确认 -> [@确认1]
    && !refs.has('确认') && !refs.has('main');   // QueryMsg 原名/定义行不计
  console.log(`${ok ? 'PASS' : 'FAIL'} 标签引用统计: 战斗=${(refs.get('战斗') || []).length} 确认1=${(refs.get('确认1') || []).length}`);
  if (!ok) fail++;
  // ReferenceProvider: 光标在定义行 [@战斗] 上 -> 2 处引用
  const rp = new M2ReferenceProvider();
  const locs = rp.provideReferences(rdoc, new Position(5, 2));
  ok = locs.length === 2 && locs[0].range.start.line === 2;
  console.log(`${ok ? 'PASS' : 'FAIL'} 标签引用跳转: ${locs.length} 处`);
  if (!ok) fail++;
  // CodeLens: 3 个标签各一个, [@战斗] 显示 2 处调用且可点击
  const lenses = new M2LabelCodeLensProvider().provideCodeLenses(rdoc);
  const lensBattle = lenses.find((l) => l.range.start.line === 5);
  ok = lenses.length === 3 && lensBattle && lensBattle.command.title.includes('2 处调用')
    && lensBattle.command.command === 'editor.action.showReferences';
  console.log(`${ok ? 'PASS' : 'FAIL'} 标签CodeLens: ${lenses.length} 个`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 标签引用功能: ' + e.message);
}

// SENDMSG: A字段出编号选择, 选中后带B占位符且无多余Tab位, snippet 不含C/D占位符
test('SENDMSG 类型编号全量', doc2, 13, 8, true, (items) => {
  const n5 = items.find((i) => String(i.label).startsWith('5 '));
  if (!n5) return '缺类型5';
  const v = String(n5.insertText && n5.insertText.value);
  return /^5 \$\{1:文字内容\}$/.test(v) ? '' : 'insertText应为"5 ${1:文字内容}": ' + v;
});
test('SENDMSG 编号前缀过滤', doc2, 14, 9, true, (items) => {
  const bad = items.filter((i) => !String(i.label).startsWith('2'));
  return bad.length ? `含非2开头项:${bad[0].label}` : (items.some((i) => String(i.label).includes('喊话')) ? '' : '缺21喊话');
});
test('SENDMSG snippet无C/D', doc, 4, 0, true, (items) => {
  const s = items.find((i) => i.label === 'SENDMSG');
  if (!s) return '缺SENDMSG';
  const v = String(s.insertText && s.insertText.value);
  if (/\$\{?[0-9]/.test(v)) return '不应含tabstop: ' + v;
  return (!s.command || s.command.command !== 'editor.action.triggerSuggest') ? '缺自动弹出编号列表command' : '';
});
test('#C 补全含#CALL', doc2, 15, 2, true, (items) => items.some((i) => i.label === '#CALL') ? '' : '缺#CALL');

// #CALL 行解析
try {
  const { parseCallLine } = require('../out/providers/definition');
  const pc = parseCallLine('#CALL [\\商城\\回收.txt] @回收');
  const ok = pc && pc.file === '\\商城\\回收.txt' && pc.label === '回收';
  console.log(`${ok ? 'PASS' : 'FAIL'} #CALL行解析: ${JSON.stringify(pc)}`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL #CALL行解析: ' + e.message);
}

// 颜色检测与调整
try {
  const { M2ColorProvider, nearestPaletteIndex } = require('../out/providers/color');
  const cp = new M2ColorProvider();
  const cdoc = makeDoc('MOV s$Ui <Text|color=224|text=hi>\nMOV s$Ui <Text|color=#0xffffa500>\nbgcolor=ffa500\nwidth=123456\n');
  const colors = cp.provideDocumentColors(cdoc);
  let ok = colors.length === 3;
  if (ok) {
    const [c1, c2, c3] = colors;
    // color=224 -> 调色板224号 00fb00
    ok = c1.color.green.toFixed(3) === (251 / 255).toFixed(3) && c1.range.start.line === 0;
    // #0xffffa500 -> 橙 r=1 g=165/255 b=0 alpha=1
    ok = ok && Math.abs(c2.color.red - 1) < 0.01 && Math.abs(c2.color.green - 165 / 255) < 0.01 && c2.color.alpha === 1;
    ok = ok && c3.range.start.line === 2;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} 颜色识别: ${colors.length} 处 ${ok ? '' : JSON.stringify(colors.map(c => c.range.start))}`);
  if (!ok) fail++;
  // 颜色回写
  const p1 = cp.provideColorPresentations(new Color(0, 251 / 255, 0, 1), { document: cdoc, range: colors[0].range });
  const p2 = cp.provideColorPresentations(new Color(1, 165 / 255, 0, 1), { document: cdoc, range: colors[1].range });
  const p3 = cp.provideColorPresentations(new Color(1, 165 / 255, 0, 1), { document: cdoc, range: colors[2].range });
  const pok = p1[0].label === '224' && p2[0].label === '#0xffffa500' && p3[0].label === 'ffa500';
  console.log(`${pok ? 'PASS' : 'FAIL'} 颜色回写: ${p1[0].label} | ${p2[0].label} | ${p3[0].label}`);
  if (!pok) fail++;
  // 最近调色板编号
  const ni = nearestPaletteIndex(new Color(0, 0.98, 0, 1));
  const nok = ni === 224;
  console.log(`${nok ? 'PASS' : 'FAIL'} 最近调色板编号: ${ni}`);
  if (!nok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 颜色功能: ' + e.message);
}

// <$cfg_名称(行_列)> 解析与csv列偏移
try {
  const { parseCfgRef, csvFieldOffset } = require('../out/providers/definition');
  const refs = parseCfgRef('SENDMSG 5 价格:<$cfg_物品价格(1_7)>');
  let ok = refs.length === 1 && refs[0].name === '物品价格' && refs[0].row === 1 && refs[0].col === 7;
  // 行列含变量: 只解析出文件名, 不给出行列
  const v1 = parseCfgRef('<$cfg_guanzhi(<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>_1)>');
  ok = ok && v1.length === 1 && v1[0].name === 'guanzhi' && v1[0].row === undefined && v1[0].col === undefined
    && v1[0].end === '<$cfg_guanzhi(<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>_1)>'.length;
  const v2 = parseCfgRef('<$cfg_guanzhi(1_<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>)>');
  ok = ok && v2.length === 1 && v2[0].name === 'guanzhi' && v2[0].row === undefined;
  ok = ok && csvFieldOffset('a,b,c,d', 2) === 4 && csvFieldOffset('a,b', 7) === 3 && csvFieldOffset('a,b,c', 0) === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} cfg引用解析: ${JSON.stringify(refs[0])} ${JSON.stringify(v1[0])}`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL cfg引用解析: ' + e.message);
}

// [@标签] 折叠范围
try {
  const { M2FoldingProvider } = require('../out/providers/folding');
  const fdoc = makeDoc('[@甲]\n#IF\nTRUE\n\n[@乙]\n#ACT\nBREAK\n\n\n[@丙]\n#SAY\n你好\n');
  const ranges = new M2FoldingProvider().provideFoldingRanges(fdoc);
  const got = ranges.map((r) => `${r.start}-${r.end}`).join(',');
  const ok = got === '0-2,4-6,9-11';
  console.log(`${ok ? 'PASS' : 'FAIL'} 标签折叠范围: ${got}`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 标签折叠: ' + e.message);
}

// RandomStr 权重解析与 CodeLens
try {
  const { RandomStrCodeLensProvider, parseRandomStrList } = require('../out/providers/randomStrLens');
  const items = parseRandomStrList('裁决,10|骨玉,30|龙纹,50');
  let ok = items.length === 3 && items[0].name === '裁决' && items[0].weight === 10 && items[2].weight === 50;
  // 权重为变量时 weight 为 undefined; 名字含逗号时按最后逗号切分
  const v = parseRandomStrList('幸运项链,一,20|宝箱,<$STR(S1)>|空组');
  ok = ok && v.length === 3 && v[0].name === '幸运项链,一' && v[0].weight === 20
    && v[1].name === '宝箱' && v[1].weight === undefined && v[2].weightRaw === '';
  const lenses = new RandomStrCodeLensProvider().provideCodeLenses(makeDoc('[@main]\n#ACT\nRandomStr 裁决,10|骨玉,30|龙纹,50 S1\nMOV S0 1\n'));
  ok = ok && lenses.length === 1 && lenses[0].range.start.line === 2
    && lenses[0].command.command === 'm2script.simRandomStr'
    && lenses[0].command.arguments[0] === '裁决,10|骨玉,30|龙纹,50';
  console.log(`${ok ? 'PASS' : 'FAIL'} RandomStr权重解析与CodeLens`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL RandomStr: ' + e.message);
}

// 激活测试
try {
  const ext = require('../out/extension');
  const ctx = { subscriptions: [] };
  ext.activate(ctx);
  console.log('PASS activate: subscriptions=' + ctx.subscriptions.length);
} catch (e) {
  fail++;
  console.log('FAIL activate: ' + e.stack.split('\n').slice(0, 3).join(' | '));
}

// QueryMsg 的 @标签 -> 引擎实际执行 [@标签1], 跳转需优先命中带后缀的标签
(async () => {
  try {
    const { M2DefinitionProvider } = require('../out/providers/definition');
    const dp = new M2DefinitionProvider();
    const mkQ = (labelLine) => makeDoc(`[@main]\n#ACT\n${labelLine}\n\n[@技能修炼_确定选择卸下1]\n#ACT\nMESSAGEBOX 好\n\n[@确认]\n#ACT\nBREAK`);
    // 1. QueryMsg 行: @技能修炼_确定选择卸下 -> 跳到 [@技能修炼_确定选择卸下1] (行4)
    const d1 = mkQ('QueryMsg 确定要卸下该技能吗 @技能修炼_确定选择卸下');
    const p1 = new Position(2, d1.lineAt(2).text.indexOf('@') + 2);
    const r1 = await dp.provideDefinition(d1, p1);
    let ok = !!r1 && r1.range.line === 4;
    // 2. 不存在 [@标签1] 时回退 [@标签]
    const d2 = makeDoc('[@main]\n#ACT\nQueryMsg 确定吗 @确认\n\n[@确认]\n#ACT\nBREAK');
    const p2 = new Position(2, d2.lineAt(2).text.indexOf('@') + 2);
    const r2 = await dp.provideDefinition(d2, p2);
    ok = ok && !!r2 && r2.range.line === 4;
    // 3. 非 QueryMsg 行(GOTO)不受后缀影响: 同名两标签都在时仍跳 [@确认]
    const d3 = makeDoc('[@main]\n#ACT\nGOTO @确认\n\n[@确认1]\n#ACT\nBREAK\n\n[@确认]\n#ACT\nBREAK');
    const p3 = new Position(2, d3.lineAt(2).text.indexOf('@') + 2);
    const r3 = await dp.provideDefinition(d3, p3);
    ok = ok && !!r3 && r3.range.line === 8;
    console.log(`${ok ? 'PASS' : 'FAIL'} QueryMsg标签跳转: [@标签1]=${r1 && r1.range.line} 回退=${r2 && r2.range.line} GOTO=${r3 && r3.range.line}`);
    if (!ok) fail++;

    // 文件路径跳转: PosInlist 的 ..\QuestDiary\... 与 #CALL 的 [文件] @标签
    const fsx = require('fs'), osx = require('os'), pathx = require('path');
    const tmp = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'm2def-'));
    fsx.mkdirSync(pathx.join(tmp, 'QuestDiary', '数据文件'), { recursive: true });
    fsx.writeFileSync(pathx.join(tmp, 'QuestDiary', '数据文件', '权限账号.txt'), '; 数据\n');
    fsx.mkdirSync(pathx.join(tmp, 'QuestDiary', '游戏功能', '临时属性'), { recursive: true });
    fsx.writeFileSync(pathx.join(tmp, 'QuestDiary', '游戏功能', '临时属性', '变量属性.txt'), '[@变量属性]\n#ACT\nBREAK\n');
    const pdoc = makeDoc('[@main]\n#ACT\nPosInlist <$STR(S$权限临时)> ..\\QuestDiary\\数据文件\\权限账号.txt\n#CALL [\\游戏功能\\临时属性\\变量属性.txt] @变量属性\n');
    pdoc.uri = { fsPath: pathx.join(tmp, 'QuestDiary', 'demo.txt'), scheme: 'file' };
    // PosInlist 路径上
    const pl = pdoc.lineAt(2).text;
    const rp1 = await dp.provideDefinition(pdoc, new Position(2, pl.indexOf('..\\') + 5));
    let ok2 = !!rp1 && /权限账号\.txt$/.test(rp1.uri.fsPath);
    // #CALL 文件部分 -> 打开文件第0行; @标签部分 -> 定位到标签行
    const cl = pdoc.lineAt(3).text;
    const rp2 = await dp.provideDefinition(pdoc, new Position(3, cl.indexOf('[') + 3));
    const rp3 = await dp.provideDefinition(pdoc, new Position(3, cl.indexOf('@变量属性') + 2));
    ok2 = ok2 && !!rp2 && /变量属性\.txt$/.test(rp2.uri.fsPath) && rp2.range.line === 0;
    ok2 = ok2 && !!rp3 && /变量属性\.txt$/.test(rp3.uri.fsPath) && rp3.range.line === 0;
    console.log(`${ok2 ? 'PASS' : 'FAIL'} 文件路径跳转: PosInlist=${rp1 && rp1.uri.fsPath} #CALL=${rp2 && rp2.uri.fsPath}:${rp2 && rp2.range.line} @标签=${rp3 && rp3.range.line}`);
    if (!ok2) fail++;

    // 当前文件在 Funtion_def 等 QuestDiary 同级目录时, #CALL 也要能跳转
    const fdoc = makeDoc('[@main]\n#ACT\n#CALL [\\游戏功能\\临时属性\\变量属性.txt] @变量属性\n');
    fdoc.uri = { fsPath: pathx.join(tmp, 'Funtion_def', 'EquipWndNpc-0.txt'), scheme: 'file' };
    const fl = fdoc.lineAt(2).text;
    const rf = await dp.provideDefinition(fdoc, new Position(2, fl.indexOf('@变量属性') + 2));
    const ok3 = !!rf && /变量属性\.txt$/.test(rf.uri.fsPath) && rf.range.line === 0;
    console.log(`${ok3 ? 'PASS' : 'FAIL'} Funtion_def内#CALL跳转: ${rf && rf.uri.fsPath}:${rf && rf.range.line}`);
    if (!ok3) fail++;
  } catch (e) {
    fail++;
    console.log('FAIL QueryMsg标签跳转: ' + e.message);
  }
  process.exit(fail ? 1 : 0);
})();
