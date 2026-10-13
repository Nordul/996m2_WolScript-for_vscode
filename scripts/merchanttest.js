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

console.log('\n全部通过: ' + passed + ' 项');
