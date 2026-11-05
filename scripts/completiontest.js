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
class DocumentLink {
  constructor(range, target) { this.range = range; this.target = target; }
}
class ThemeColor {
  constructor(id) { this.id = id; }
}
class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}
class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
}
const selectionChangeHandlers = [];
const commandHandlers = new Map();
let definitionSelector;
const vscodeMock = {
  Position, Range, Selection, SnippetString, MarkdownString, CompletionItem, FoldingRange, Location, CodeLens, Hover,
  Color, ColorInformation, ColorPresentation, DocumentLink, ThemeColor, Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  FoldingRangeKind: { Region: 3 },
  CompletionItemKind: {
    Function: 2, Variable: 4, Class: 5, Property: 9, Keyword: 13, Snippet: 14,
    Reference: 17, Operator: 11, Event: 22, EnumMember: 19,
  },
  TextEditorRevealType: { InCenter: 1 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  Uri: {
    file: (f) => ({ fsPath: f, scheme: 'file', authority: '', with(change) { return { ...this, ...change }; } }),
    parse: (value) => ({ scheme: value.split(':')[0], value, toString: () => value }),
  },
  languages: {
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
    registerDefinitionProvider: (selector) => { definitionSelector = selector; return { dispose() {} }; },
    registerDocumentHighlightProvider: () => ({ dispose() {} }),
    registerFoldingRangeProvider: () => ({ dispose() {} }),
    registerColorProvider: () => ({ dispose() {} }),
    registerDocumentLinkProvider: () => ({ dispose() {} }),
    registerReferenceProvider: () => ({ dispose() {} }),
    registerCodeLensProvider: () => ({ dispose() {} }),
    createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }),
    setTextDocumentLanguage: async () => undefined,
  },
  window: {
    registerWebviewViewProvider: () => ({ dispose() {} }),
    showTextDocument: async () => ({ selection: null, revealRange() {} }),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createTextEditorDecorationType: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: (fn) => { selectionChangeHandlers.push(fn); return { dispose() {} }; },
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
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
    onDidChangeConfiguration: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: (key, defaultValue) => defaultValue }),
    onDidChangeTextDocument: (fn) => { documentChangeHandler = fn; return { dispose() {} }; },
  },
  commands: {
    registerCommand: (name, fn) => { commandHandlers.set(name, fn); return { dispose() {} }; },
    executeCommand: async (command, ...args) => commandHandlers.get(command)?.(...args),
  },
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
    getWordRangeAtPosition: (position) => {
      const pattern = new RegExp(require('../out/providers/highlightCore').WORD_PATTERN_SOURCE, 'g');
      for (const m of lines[position.line].matchAll(pattern)) {
        if (position.character >= m.index && position.character <= m.index + m[0].length) {
          return new Range(position.line, m.index, position.line, m.index + m[0].length);
        }
      }
      return undefined;
    },
    positionAt: (offset) => {
      let remaining = offset;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) return new Position(i, remaining);
        remaining -= lines[i].length + 1;
      }
      return new Position(lines.length - 1, lines[lines.length - 1].length);
    },
  };
}

const doc = makeDoc(`[@main]
#IF

#ACT

#SAY

`);

const provider = new (require('../out/providers/completion').M2CompletionProvider)();

let fail = 0;
const testQueue = [];
// provideCompletionItems 现为 async: 测试入队后由末尾统一顺序 await, 保持原有输出顺序
function test(name, target, line, ch, expectSome, sampleCheck) {
  testQueue.push((async () => {
    try {
      const items = await provider.provideCompletionItems(target, new Position(line, ch));
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
  })());
}

// #IF 段空行(行2): 应只出检测命令
test('#IF段命令补全', doc, 2, 0, true, (items) => {
  const hasCheck = items.some((i) => i.label === 'CHECKITEM');
  const hasAction = items.some((i) => i.label === 'MOV');
  return !hasCheck ? '缺CHECKITEM' : (hasAction ? '不应含MOV' : '');
});
test('#IF段TRUE补全', makeDoc('[@main]\n#IF\nTRU\n'), 2, 3, true, (items) => {
  const item = items.find((i) => i.label === 'TRUE');
  if (!item) return '缺TRUE';
  return String(item.insertText && item.insertText.value) === 'TRUE' ? '' : 'TRUE插入文本错误';
});
// #ACT 段空行(行4): 应只出执行命令
test('#ACT段命令补全', doc, 4, 0, true, (items) => {
  const hasAction = items.some((i) => i.label === 'MOV');
  const hasCheck = items.some((i) => i.label === 'CHECKITEM');
  return !hasAction ? '缺MOV' : (hasCheck ? '不应含CHECKITEM' : '');
});
test('新增执行命令补全', makeDoc('[@main]\n#ACT\nRELOADS\n'), 2, 7, true, (items) => {
  return items.some((i) => i.label === 'RELOADSABUKW') ? '' : '缺RELOADSABUKW';
});
test('补录执行命令补全', makeDoc('[@main]\n#ACT\nADDSU\n'), 2, 5, true, (items) => {
  return items.some((i) => i.label === 'AddSuiteAbil') ? '' : '缺AddSuiteAbil';
});
test('DelBtn命令补全', makeDoc('[@main]\n#ACT\nDELB\n'), 2, 4, true, (items) => {
  const item = items.find((i) => i.label === 'DelBtn');
  return item && String(item.insertText?.value) === 'DelBtn ${1:A}$0' ? '' : '缺DelBtn或参数补全错误';
});
test('SETPLAYCFG与SetMiniMapCfg补全', makeDoc('[@main]\n#ACT\nSET\n'), 2, 3, true, (items) => {
  const play = items.find((i) => i.label === 'SETPLAYCFG');
  const mini = items.find((i) => i.label === 'SetMiniMapCfg');
  return play && mini && String(play.insertText?.value) === 'SETPLAYCFG ${1:A}$0'
    && String(mini.insertText?.value) === 'SetMiniMapCfg ${1:A} ${2:B}$0' ? '' : '缺SETPLAYCFG或SetMiniMapCfg';
});
test('补录检测命令补全', makeDoc('[@main]\n#IF\nCHECKLE\n'), 2, 7, true, (items) => {
  return items.some((i) => i.label === 'CHECKLEVEL') ? '' : '缺CHECKLEVEL';
});
test('GIVE命令不立即重开命令列表', makeDoc('[@main]\n#ACT\nGI\n'), 2, 2, true, (items) => {
  const give = items.find((i) => i.label === 'GIVE');
  const giveb = items.find((i) => i.label === 'GIVEB');
  return !give?.command && !giveb?.command && String(give.insertText?.value) === 'GIVE ${1:A} ${2:B} ${3:C} ${4:D}$0'
    ? '' : 'GIVE/GIVEB应立即触发或占位符错误';
});
test('检测命令不立即重开命令列表', makeDoc('[@main]\n#IF\nCHECKI\n'), 2, 6, true, (items) => {
  const check = items.find((i) => i.label === 'CHECKITEM');
  return !check?.command ? '' : 'CHECKITEM不应立即重开命令列表';
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
const strShortcutDoc = makeDoc('GIVE <$STR> B C D\nGIVE <$BINDMONEY> B C D\n');
const strShortcutPos = strShortcutDoc.lineAt(0).text.indexOf('>');
test('输入STR显示变量取值快捷项', strShortcutDoc, 0, strShortcutPos, true, (items) => {
  const item = items.find((i) => i.label === '$STR(变量)');
  if (!item) return '缺$STR(变量)';
  return String(item.insertText?.value) === '\\$STR(${1:S0}$0)>' && item.range.end.character === strShortcutPos + 1
    ? '' : 'STR插入文本或闭合符吞并错误';
});
test('输入BINDMONEY显示组合货币快捷项', strShortcutDoc, 1, strShortcutDoc.lineAt(1).text.indexOf('>'), true, (items) => {
  const item = items.find((i) => i.label === '$BINDMONEY(货币)');
  if (!item) return '缺$BINDMONEY(货币)';
  return String(item.insertText?.value) === '\\$BINDMONEY(${1:元宝}$0)>' ? '' : 'BINDMONEY插入文本错误';
});
test('$STR( 内变量类型', doc2, 5, 12, true);
const namedVarDoc = makeDoc('[@main]\n#ACT\nMOV S$测试 1\nGIVE <$STR(S$测)> B C D\n');
const namedVarPos = namedVarDoc.lineAt(3).text.indexOf('测') + 1;
test('$STR中文命名变量及自动闭合', namedVarDoc, 3, namedVarPos, true, (items) => {
  const item = items.find((i) => i.label === 'S$测试');
  if (!item) return '缺S$测试';
  return item.range.start.character === namedVarPos - 3 && item.range.end.character === namedVarPos ? '' : '命名变量替换范围错误';
});
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
test('PC XYBTN补全与参数片段', makeDoc('[@main]\n#SAY\n<@!XYB\n'), 2, 6, true, (items) => {
  const item = items.find((i) => i.label === 'XYBTN');
  return item && String(item.insertText?.value).startsWith('@@!XYBTN ')
    && String(item.insertText?.value).includes('${9:/@标签}') ? '' : '缺XYBTN或参数片段错误';
});
test('PC XYITMC与XYPIC补全', makeDoc('[@main]\n#SAY\n<@@!XY\n'), 2, 6, true, (items) => {
  const itmc = items.find((i) => i.label === 'XYITMC');
  const pic = items.find((i) => i.label === 'XYPIC');
  return itmc && pic && String(itmc.insertText?.value).startsWith('@@!XYITMC ')
    && String(pic.insertText?.value).startsWith('@@!XYPIC ') ? '' : '缺XYITMC或XYPIC';
});
test('PC offx参数补全', makeDoc('[@main]\n#SAY\n<offx=|9|\n'), 2, 9, true, (items) => {
  const names = ['y', 'fontsize', 'font', 'xy', 'ax', 'ay'];
  const missing = names.filter((name) => !items.some((i) => i.label === name));
  const y = items.find((i) => i.label === 'y');
  return missing.length ? `缺参数:${missing.join(',')}` : (String(y.insertText?.value) === 'y=${1:}' ? '' : 'y参数片段错误');
});
test('PC Color补全', makeDoc('[@main]\n#SAY\n<Col\n'), 2, 4, true, (items) => {
  const item = items.find((i) => i.label === 'Color');
  return item && String(item.insertText?.value) === 'Color=${1:green} ${2:文字}$0>' ? '' : '缺Color或片段错误';
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
  testQueue.push((async () => {
    const locs = await rp.provideReferences(rdoc, new Position(5, 2));
    const refOk = locs.length === 2 && locs[0].range.start.line === 2;
    console.log(`${refOk ? 'PASS' : 'FAIL'} 标签引用跳转: ${locs.length} 处`);
    if (!refOk) fail++;
  })());
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
  // 调色板颜色的颜色卡应只含 0-255 编号(最近编号置顶); 16进制只回写16进制格式
  const labels = new Set(p1.map((x) => x.label));
  let allIdx = p1.length === 256;
  for (let i = 0; i <= 255; i++) allIdx = allIdx && labels.has(String(i));
  const hexOnly = p2.length === 1 && p3.length === 1;
  console.log(`${allIdx && hexOnly ? 'PASS' : 'FAIL'} 颜色卡分类: 调色板${p1.length}项 16进制各${p2.length}/${p3.length}项`);
  if (!(allIdx && hexOnly)) fail++;
  // 最近调色板编号
  const ni = nearestPaletteIndex(new Color(0, 0.98, 0, 1));
  const nok = ni === 224;
  console.log(`${nok ? 'PASS' : 'FAIL'} 最近调色板编号: ${ni}`);
  if (!nok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 颜色功能: ' + e.message);
}

// 颜色 Ctrl+点击链接
try {
  const { M2ColorDefinitionProvider, consumeColorNavigation } = require('../out/providers/color');
  const provider = new M2ColorDefinitionProvider();
  const doc = makeDoc('color=224\nbgcolor=#0xffffa500\ncolor=cccc99');
  const links = [
    provider.provideDefinition(doc, new Position(0, 2)),
    provider.provideDefinition(doc, new Position(1, 12)),
    provider.provideDefinition(doc, new Position(2, 2)),
  ];
  const navigation = consumeColorNavigation({ document: doc, selection: { active: new Position(2, 0) } });
  const consumedAgain = consumeColorNavigation({ document: doc, selection: { active: new Position(2, 0) } });
  const noLink = provider.provideDefinition(doc, new Position(0, 20));
  const ok = links.every((group) => group.length === 1 && group[0].uri === doc.uri && !group[0].targetUri)
    && navigation?.line === 2 && navigation.character === 0 && consumedAgain === undefined && noLink.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} 颜色Ctrl+点击定位并打开面板`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 颜色Ctrl+点击链接: ' + e.message);
}

// 颜色选择面板: 检测、格式输出、插入替换与加载
try {
  const { colorCodeAtCursor, colorText, colorEditAtCursor, hexColorText, hexColorEditAtCursor, colorPickerFormat, ColorPickerProvider } = require('../out/views/colorPickerPanel');
  const line = 'MOV S0 <Text|color=224|text=hi>';
  const match = colorCodeAtCursor(line, line.indexOf('224') + 1);
  const hexMatch = colorCodeAtCursor('bgcolor=#0xffffa500', 12);
  const bareMatch = colorCodeAtCursor('color=ffa500', 2);
  const paletteEdit = colorEditAtCursor(line, line.indexOf('224') + 1, 0, 'hex');
  const hexEdit = colorEditAtCursor('bgcolor=#0xffffa500', 12, 224, 'palette');
  const barePaletteEdit = colorEditAtCursor('color=ffa500', 2, 224, 'palette');
  const bareHexEdit = colorEditAtCursor('color=ffa500', 2, 0, 'hex');
  const insert = colorEditAtCursor('MOV S0 ', 7, 224, 'palette');
  const customHexEdit = hexColorEditAtCursor('bgcolor=#0xffffa500', 12, '#A1B2C3', 'hex');
  const customBareHexEdit = hexColorEditAtCursor('color=ffa500', 2, 'a1b2c3', 'hex');
  const customHexInsert = hexColorEditAtCursor('MOV S0 ', 7, 'a1b2c3', 'hex');
  const ok = match?.kind === 'palette' && match.index === 224 && match.text === 'color=224'
    && hexMatch?.kind === 'hex' && hexMatch.text === '#0xffffa500'
    && bareMatch?.kind === 'bareHex' && bareMatch.text === 'color=ffa500'
    && paletteEdit?.newText === '#0xff000000' && paletteEdit.start === match.start && paletteEdit.end === match.end
    && hexEdit?.newText === 'color=224' && hexEdit.start === 8 && hexEdit.end === 19
    && barePaletteEdit?.newText === 'color=00fb00' && barePaletteEdit.start === 0 && barePaletteEdit.end === 12
    && bareHexEdit?.newText === 'color=000000'
    && insert?.newText === 'color=224' && insert.start === 7 && insert.end === 7
    && colorText(224, 'hex') === '#0xff00fb00'
    && colorText(0, 'bareHex') === 'color=000000'
    && hexColorText('#A1B2C3', 'hex') === '#0xffa1b2c3'
    && hexColorText('invalid', 'hex') === undefined
    && customHexEdit?.newText === '#0xffa1b2c3' && customHexEdit.start === 8 && customHexEdit.end === 19
    && customBareHexEdit?.newText === 'color=a1b2c3'
    && customHexInsert?.newText === '#0xffa1b2c3'
    && colorPickerFormat(match, 'hex') === 'palette'
    && colorPickerFormat(hexMatch, 'palette') === 'hex'
    && colorPickerFormat(bareMatch, 'palette') === 'hex'
    && colorPickerFormat(undefined, 'hex') === 'hex';
  let stateMsg;
  const view = { webview: { options: {}, html: '', onDidReceiveMessage: () => undefined, postMessage: async (msg) => { stateMsg = msg; } } };
  vscodeMock.window.activeTextEditor = { document: makeDoc('color=cccc99'), selection: { active: new Position(0, 3) } };
  new ColorPickerProvider({ subscriptions: [] }).resolveWebviewView(view);
  vscodeMock.window.activeTextEditor = undefined;
  const loaded = view.webview.html.includes('formatEl.hidden = !!state.currentKind') && view.webview.html.includes('type: \'pick\'')
    && view.webview.html.includes('type="color"') && view.webview.html.includes('type: \'pickHex\'')
    && view.webview.html.includes('hexTools.hidden = state.format !== \'hex\'')
    && stateMsg?.currentHex === 'cccc99' && stateMsg?.currentKind === 'bareHex' && stateMsg?.format === 'hex';
  console.log(`${ok && loaded ? 'PASS' : 'FAIL'} 颜色选择面板与插入替换`);
  if (!ok || !loaded) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 颜色选择面板: ' + e.message);
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

// Getcsv 悬停: Row/Col 参数说明、大小写与表达式范围
try {
  const { M2HoverProvider } = require('../out/providers/hover');
  const text = 'SENDMSG 5 行数:<$Getcsv(cfg_物品价格,Row)> 列数:<$GetCsv(cfg_物品价格,Col)>';
  const doc = makeDoc(text);
  const provider = new M2HoverProvider();
  const rowStart = text.indexOf('<$Getcsv');
  const rowEnd = rowStart + '<$Getcsv(cfg_物品价格,Row)>'.length;
  const colStart = text.indexOf('<$GetCsv');
  const rowHover = provider.provideHover(doc, new Position(0, rowStart + 5));
  const colHover = provider.provideHover(doc, new Position(0, colStart + 5));
  const rowText = rowHover?.contents.value || '';
  const colText = colHover?.contents.value || '';
  const ok = rowText.includes('Row（行数）') && rowText.includes('Col（列数）')
    && rowText.includes('cfg_文件名') && rowText.includes('/17/1029')
    && rowHover.range.start.character === rowStart && rowHover.range.end.character === rowEnd
    && colText.includes('获取最大列数');
  console.log(`${ok ? 'PASS' : 'FAIL'} Getcsv悬停: Row/Col说明与范围`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL Getcsv悬停: ' + e.message);
}

// 其余 CSV 宏与命令悬停
try {
  const { M2HoverProvider } = require('../out/providers/hover');
  const provider = new M2HoverProvider();
  const hoverAt = (text, token) => {
    const doc = makeDoc(text);
    return provider.provideHover(doc, new Position(0, text.indexOf(token) + 1))?.contents.value || '';
  };
  const cfgText = hoverAt('SENDMSG 5 <$cfg_guanzhi(1_2)>', 'cfg_guanzhi');
  const beginText = hoverAt('SENDMSG 5 <$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>', 'GetTypeBRow');
  const endText = hoverAt('SENDMSG 5 <$GetTypeERow(cfg_guanzhi,5,GUANJIAN)>', 'GetTypeERow');
  const readText = hoverAt('NEWREADCSV ..\\Data\\cfg_guanzhi.csv', 'NEWREADCSV');
  const dqText = hoverAt('NEWDQCSV ..\\QuestDiary\\test.csv 2 2 S0', 'NEWDQCSV');
  const hlText = hoverAt('GETHLCSV ..\\QuestDiary\\test.csv 0 N0', 'GETHLCSV');
  const gjText = hoverAt('GETGJCSV ..\\QuestDiary\\test.csv abc 0~10 4 0 S0', 'GETGJCSV');
  const ok = cfgText.includes('行列默认从 0 开始')
    && beginText.includes('起始行') && beginText.includes('列号')
    && endText.includes('结束行') && endText.includes('关键字')
    && readText.includes('加载csv表格') && dqText.includes('指定行列')
    && hlText.includes('最大行数或最大列数') && gjText.includes('行号');
  console.log(`${ok ? 'PASS' : 'FAIL'} 全部CSV宏与命令悬停`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL 全部CSV宏与命令悬停: ' + e.message);
}

// PC界面组件悬停文档
try {
  const { M2HoverProvider } = require('../out/providers/hover');
  const provider = new M2HoverProvider();
  const hoverAt = (text, token) => {
    const doc = makeDoc(text);
    return provider.provideHover(doc, new Position(0, text.indexOf(token) + 1))?.contents.value || '';
  };
  const btn = hoverAt('<@!XYBTN 3,80,3,81,3,82,335,-8/@exit>', 'XYBTN');
  const offx = hoverAt('<offx=|9|y=|16|fontsize=|12|font=|2|xy=|1|>文字<|off>', 'offx');
  const color = hoverAt('<Color=green 文字>', 'Color');
  const edit = hoverAt('<@@!EDIT 1,300,158,180,18,20,0,请输入,NAME=1>', 'EDIT');
  const itmc = hoverAt('<@@!XYITMC 3,60,0,0>', 'XYITMC');
  const pic = hoverAt('<@@!XYPIC 3,60,0,0>', 'XYPIC');
  const ok = btn.includes('绝对坐标自定义按钮') && btn.includes('/17/1145')
    && offx.includes('fontsize') && offx.includes('字体样式') && offx.includes('/17/1139')
    && color.includes('自定义文字颜色') && edit.includes('$NPCINPUT') && edit.includes('/17/1136')
    && itmc.includes('XYITM扩展图片组件') && pic.includes('绝对坐标图片组件');
  console.log(`${ok ? 'PASS' : 'FAIL'} PC界面组件悬停文档`);
  if (!ok) fail++;
} catch (e) {
  fail++;
  console.log('FAIL PC界面组件悬停: ' + e.message);
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
  const remoteSelectorOk = Array.isArray(definitionSelector)
    && definitionSelector.some((item) => item.scheme === 'file')
    && definitionSelector.some((item) => item.scheme === 'vscode-remote');
  console.log(`${remoteSelectorOk ? 'PASS' : 'FAIL'} activate: subscriptions=${ctx.subscriptions.length} SSH选择器=${remoteSelectorOk}`);
  if (!remoteSelectorOk) fail++;
} catch (e) {
  fail++;
  console.log('FAIL activate: ' + e.stack.split('\n').slice(0, 3).join(' | '));
}

// QueryMsg 的 @标签 -> 引擎实际执行 [@标签1], 跳转需优先命中带后缀的标签
(async () => {
  // 先跑完上面入队的补全测试 (provider 已是 async)
  for (const p of testQueue) await p;

  try {
    let focused = false;
    commandHandlers.set('m2script.colorPicker.focus', () => { focused = true; });
    vscodeMock.window.activeTextEditor = { document: makeDoc('color=cccc99'), selection: null };
    await commandHandlers.get('m2script.openColorPicker')(0, 3);
    const selection = vscodeMock.window.activeTextEditor.selection;
    const ok = focused && selection.start.line === 0 && selection.start.character === 3
      && selection.end.line === 0 && selection.end.character === 3;
    console.log(`${ok ? 'PASS' : 'FAIL'} 颜色点击后定位光标并聚焦面板`);
    if (!ok) fail++;
  } catch (e) {
    fail++;
    console.log('FAIL 颜色面板聚焦命令: ' + e.message);
  } finally {
    vscodeMock.window.activeTextEditor = undefined;
  }

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

    // 普通 @标签: 当前文件未命中时跨文件搜索, GBK 文件按原始字节解码
    const gbkTarget = pathx.join(tmp, 'QuestDiary', '游戏功能', '跨文件.txt');
    fsx.writeFileSync(gbkTarget, require('iconv-lite').encode('[@跨文件标签]\n#ACT\nBREAK\n', 'gbk'));
    vscodeMock.workspace.findFiles = async () => [{ fsPath: gbkTarget, scheme: 'file' }];
    vscodeMock.workspace.fs.readFile = async (u) => fsx.readFileSync(u.fsPath);
    const crossDoc = makeDoc('[@main]\n#ACT\nGOTO @跨文件标签\n');
    crossDoc.uri = { fsPath: pathx.join(tmp, 'QuestDiary', 'cross.txt'), scheme: 'file' };
    const crossLine = crossDoc.lineAt(2).text;
    const rc = await dp.provideDefinition(crossDoc, new Position(2, crossLine.indexOf('@') + 2));
    const ok4 = !!rc && !Array.isArray(rc) && rc.uri.fsPath === gbkTarget && rc.range.line === 0;
    console.log(`${ok4 ? 'PASS' : 'FAIL'} GBK跨文件标签跳转: ${rc && rc.uri && rc.uri.fsPath}:${rc && rc.range && rc.range.line}`);
    if (!ok4) fail++;

    // 当前文件定义优先于其它文件; 多个跨文件同名定义全部作为候选返回
    const secondTarget = pathx.join(tmp, 'QuestDiary', '游戏功能', '第二定义.txt');
    fsx.writeFileSync(secondTarget, '[@main]\n\n  [@变量属性]\n');
    vscodeMock.workspace.findFiles = async () => [gbkTarget, secondTarget].map((fsPath) => ({ fsPath, scheme: 'file' }));
    const localDoc = makeDoc('[@main]\nGOTO @变量属性\n[@变量属性]\n');
    localDoc.uri = crossDoc.uri;
    const localLine = localDoc.lineAt(1).text;
    const rl = await dp.provideDefinition(localDoc, new Position(1, localLine.indexOf('@') + 2));
    const ok5 = !!rl && !Array.isArray(rl) && rl.uri.fsPath === crossDoc.uri.fsPath && rl.range.line === 2;
    const multiDoc = makeDoc('[@main]\nGOTO @变量属性\n');
    multiDoc.uri = crossDoc.uri;
    const multiLine = multiDoc.lineAt(1).text;
    const rm = await dp.provideDefinition(multiDoc, new Position(1, multiLine.indexOf('@') + 2));
    const ok6 = !!rm && !Array.isArray(rm) && rm.uri.fsPath === secondTarget && rm.range.line === 2;
    console.log(`${ok5 ? 'PASS' : 'FAIL'} 当前文件标签优先: ${rl && rl.range && rl.range.line}`);
    console.log(`${ok6 ? 'PASS' : 'FAIL'} 跨文件标签定位: ${Array.isArray(rm) ? rm.map((r) => `${r.uri.fsPath}:${r.range.line}`).join(',') : rm}`);
    if (!ok5) fail++;
    if (!ok6) fail++;

    // 真正存在多个同名定义时返回全部候选
    const variableTarget = pathx.join(tmp, 'QuestDiary', '游戏功能', '临时属性', '变量属性.txt');
    vscodeMock.workspace.findFiles = async () => [variableTarget, secondTarget].map((fsPath) => ({ fsPath, scheme: 'file' }));
    const rma = await dp.provideDefinition(multiDoc, new Position(1, multiLine.indexOf('@') + 2));
    const ok7 = Array.isArray(rma) && rma.length === 2 && rma.every((r) => r.range.line === 0 || r.range.line === 2);
    console.log(`${ok7 ? 'PASS' : 'FAIL'} 多个同名标签候选: ${Array.isArray(rma) ? rma.length : rma}`);
    if (!ok7) fail++;

    // 从 [@标签] 反查调用: 合并当前文件与跨文件 GOTO/#CALL 引用
    const callerTarget = pathx.join(tmp, 'QuestDiary', '游戏功能', '调用方.txt');
    fsx.writeFileSync(callerTarget, require('iconv-lite').encode('[@main]\n#ACT\nGOTO @变量属性\n#CALL [\\游戏功能\\临时属性\\变量属性.txt] @变量属性\n', 'gbk'));
    vscodeMock.workspace.findFiles = async () => [{ fsPath: callerTarget, scheme: 'file' }];
    const reverseDoc = makeDoc('[@变量属性]\n#ACT\nGOTO @变量属性\n');
    reverseDoc.uri = { fsPath: variableTarget, scheme: 'file' };
    const { M2ReferenceProvider } = require('../out/providers/references');
    const reverseRefs = await new M2ReferenceProvider().provideReferences(reverseDoc, new Position(0, 2));
    const reverseDefs = await dp.provideDefinition(reverseDoc, new Position(0, 2));
    const validReverse = (items) => Array.isArray(items) && items.length === 3
      && items[0].uri.fsPath === variableTarget && items[0].range.start.line === 2
      && items[1].uri.fsPath === callerTarget && items[1].range.start.line === 2
      && items[2].uri.fsPath === callerTarget && items[2].range.start.line === 3;
    const ok8 = validReverse(reverseRefs) && validReverse(reverseDefs);
    console.log(`${ok8 ? 'PASS' : 'FAIL'} 跨文件反查标签调用: Shift+F12=${Array.isArray(reverseRefs) ? reverseRefs.length : reverseRefs} Ctrl+点击=${Array.isArray(reverseDefs) ? reverseDefs.length : reverseDefs}`);
    if (!ok8) fail++;

    // SSH 远程文档: 保留 vscode-remote scheme/authority, 远程未保存文档参与跳转与反查
    const authority = 'ssh-remote+test';
    const remoteCallDoc = makeDoc('[@main]\n#ACT\n#CALL [\\游戏功能\\临时属性\\变量属性.txt] @变量属性\n');
    remoteCallDoc.uri = { fsPath: crossDoc.uri.fsPath, scheme: 'vscode-remote', authority };
    const remoteCallLine = remoteCallDoc.lineAt(2).text;
    const remoteCallResult = await dp.provideDefinition(remoteCallDoc, new Position(2, remoteCallLine.indexOf('@变量属性') + 2));
    const remoteCallOk = !!remoteCallResult && !Array.isArray(remoteCallResult)
      && remoteCallResult.uri.scheme === 'vscode-remote' && remoteCallResult.uri.authority === authority
      && remoteCallResult.uri.fsPath === variableTarget && remoteCallResult.range.line === 0;
    console.log(`${remoteCallOk ? 'PASS' : 'FAIL'} SSH远程#CALL跳转保留URI`);
    if (!remoteCallOk) fail++;

    const remoteTarget = makeDoc('[@远程未保存]\n#ACT\nBREAK\n');
    remoteTarget.uri = { fsPath: secondTarget, scheme: 'vscode-remote', authority };
    const remoteSearch = makeDoc('[@main]\n#ACT\nGOTO @远程未保存\n');
    remoteSearch.uri = { fsPath: crossDoc.uri.fsPath, scheme: 'vscode-remote', authority };
    let remoteReads = 0;
    vscodeMock.workspace.textDocuments = [remoteTarget];
    vscodeMock.workspace.findFiles = async () => [remoteTarget.uri];
    vscodeMock.workspace.fs.readFile = async () => { remoteReads++; throw new Error('远程已打开文档不应读取磁盘旧内容'); };
    const remoteLine = remoteSearch.lineAt(2).text;
    const remoteLabelResult = await dp.provideDefinition(remoteSearch, new Position(2, remoteLine.indexOf('@') + 2));
    const remoteLabelOk = !!remoteLabelResult && !Array.isArray(remoteLabelResult)
      && remoteLabelResult.uri === remoteTarget.uri && remoteLabelResult.range.line === 0 && remoteReads === 0;
    console.log(`${remoteLabelOk ? 'PASS' : 'FAIL'} SSH远程未保存文档标签跳转`);
    if (!remoteLabelOk) fail++;

    const remoteCaller = makeDoc('[@main]\n#ACT\nGOTO @远程未保存\n#CALL [\\游戏功能\\第二定义.txt] @远程未保存\n');
    remoteCaller.uri = { fsPath: callerTarget, scheme: 'vscode-remote', authority };
    vscodeMock.workspace.textDocuments = [remoteCaller];
    vscodeMock.workspace.findFiles = async () => [remoteCaller.uri];
    const remoteRefs = await new M2ReferenceProvider().provideReferences(remoteTarget, new Position(0, 2));
    const remoteRefsOk = Array.isArray(remoteRefs) && remoteRefs.length === 2
      && remoteRefs.every((item) => item.uri === remoteCaller.uri) && remoteReads === 0;
    console.log(`${remoteRefsOk ? 'PASS' : 'FAIL'} SSH远程标签反向引用: ${Array.isArray(remoteRefs) ? remoteRefs.length : remoteRefs}`);
    if (!remoteRefsOk) fail++;

    vscodeMock.workspace.textDocuments = [];
    vscodeMock.workspace.findFiles = async () => [];
    fsx.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    fail++;
    console.log('FAIL QueryMsg标签跳转: ' + e.message);
  }
  process.exit(fail ? 1 : 0);
})();
