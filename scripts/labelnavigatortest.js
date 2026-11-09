/* 当前文件标签导航纯逻辑自测: node scripts/labelnavigatortest.js (需先 npm run compile) */
const assert = require('assert');
const { filterScriptLabels, parseScriptLabels } = require('../out/views/labelNavigatorCore');

const text = [
  '[@main]',
  '#IF',
  'TRUE',
  '  [@技能修炼-确认] NPC(40103)',
  '#ACT',
  'GOTO @main',
  '; [@注释中的标签]',
  '文字 [@行内标签]',
  '[@重复]',
  '[@重复]',
  '[@不完整',
  '[@含空格 标签]',
].join('\r\n');

const labels = parseScriptLabels(text);
assert.deepStrictEqual(labels.map((label) => label.name), ['main', '技能修炼-确认', '重复', '重复']);
assert.deepStrictEqual(labels.map((label) => label.line), [0, 3, 8, 9]);
assert.strictEqual(labels[0].start, 0);
assert.strictEqual(labels[0].end, 7);
assert.strictEqual(labels[1].start, 2, '缩进标签应正确定位左括号');
assert.strictEqual(text.split(/\r?\n/)[3].slice(labels[1].start, labels[1].end), '[@技能修炼-确认]');
assert.strictEqual(labels.filter((label) => label.name === '重复').length, 2, '重复定义也应逐项展示');
assert.strictEqual(parseScriptLabels('').length, 0);
assert.strictEqual(parseScriptLabels('GOTO @main\n; [@main]').length, 0, '引用和注释不应被当成定义');

const searchLabels = parseScriptLabels('[@Main]\n[@技能修炼-确认]\n[@技能强化]\n[@退出]');
assert.deepStrictEqual(filterScriptLabels(searchLabels, 'main').map((label) => label.name), ['Main'], '搜索忽略大小写');
assert.deepStrictEqual(filterScriptLabels(searchLabels, '@MAIN').map((label) => label.name), ['Main'], '搜索可带@前缀');
assert.deepStrictEqual(filterScriptLabels(searchLabels, '技能 确认').map((label) => label.name), ['技能修炼-确认'], '空格分隔的多个关键词按且关系过滤');
assert.deepStrictEqual(filterScriptLabels(searchLabels, '  ').map((label) => label.name), ['Main', '技能修炼-确认', '技能强化', '退出'], '空白搜索显示全部');
assert.deepStrictEqual(filterScriptLabels(searchLabels, '不存在'), [], '无匹配时返回空列表');
assert.strictEqual(searchLabels.length, 4, '过滤不得修改原标签列表');

console.log('labelnavigatortest 全部通过');
