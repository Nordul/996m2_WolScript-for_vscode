/* 高亮相同字符串纯逻辑自测: node scripts/highlighttest.js (需先 npm run compile) */
const assert = require('assert');
const config = require('../language-configuration.json');
const { WORD_PATTERN_SOURCE, findWordMatches } = require('../out/providers/highlightCore');

const text = [
  '[@main]',
  '#ACT',
  'MOV S0 abc',
  'MOV S1 ABC',
  'MOV S2 Abc',
  'MOV S3 abcd',
  'MOV S4 xabc',
  'MOV S5 abc_def',
  'MOV S6 S$Ui',
  'INC S$UI 1',
  'MOV S7 攻击',
  'SENDMSG 攻击力 攻击',
  'MOV D0 1.5',
  'CHECK D1 1.5',
  'MOV D2 -1.5',
  'MOV S8 my-label',
].join('\n');

const values = (word) => findWordMatches(text, word).map((m) => text.slice(m.start, m.end));

assert.strictEqual(WORD_PATTERN_SOURCE, config.wordPattern, '取词规则必须与 language-configuration.json 一致');
assert.deepStrictEqual(values('abc'), ['abc', 'ABC', 'Abc'], 'abc 应整词忽略大小写命中 3 次');
assert.deepStrictEqual(values('ABC'), ['abc', 'ABC', 'Abc'], 'ABC 同样命中 3 次');
assert.deepStrictEqual(values('abc_def'), ['abc_def'], '下划线属于同一个词');
assert.deepStrictEqual(values('S$ui'), ['S$Ui', 'S$UI'], '$ 属于词内字符, 忽略大小写整词命中');
assert.deepStrictEqual(values('ui'), [], '$ 变量不会被拆成子串');
assert.deepStrictEqual(values('攻击'), ['攻击', '攻击'], '中文整词命中, 不命中 攻击力');
assert.deepStrictEqual(values('1.5'), ['1.5', '1.5'], '数字整词命中');
assert.deepStrictEqual(values('-1.5'), ['-1.5'], '负数整词命中');
assert.deepStrictEqual(values('main'), ['main'], '@main 中的 main 命中');
assert.deepStrictEqual(values('my'), ['my'], '- 是分隔符, 双击只取其中一段');
assert.deepStrictEqual(values('my-label'), [], '- 不参与整词');
assert.deepStrictEqual(values(''), [], '空字符串不命中');

const one = findWordMatches(text, '攻击')[0];
assert.strictEqual(text.slice(one.start, one.end), '攻击', '返回的偏移应可直接用于文档切片');

console.log('highlighttest 全部通过');
