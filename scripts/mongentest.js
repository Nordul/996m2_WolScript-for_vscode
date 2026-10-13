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
  '0 330 330 鹿 5 10 10',
  '0 331 330 稻草人 5 5 10',
  '坏行',
].join('\r\n');

console.log('MonGen round-trip:');
const model = parseMonGen(sample);
const rows = monGenRows(model);
ok(rows.length === 3, '解析出 3 条刷怪记录');
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

console.log('\n全部通过: ' + passed + ' 项');
