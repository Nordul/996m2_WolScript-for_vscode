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

console.log('\n全部通过: ' + passed + ' 项');
