/** MonItems 爆率解析与模拟测试（直接加载编译产物，无需 vscode） */
const assert = require('assert');
const {
  parseDropFile, serializeDropFile, itemChances, simulateDrops, seededRand,
} = require('../out/mapeditor/dropModel');

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log('  ✓ ' + label);
}

console.log('爆率解析:');
const model = parseDropFile([
  '; 注释行',
  '1/1 金币 1000',
  '1/200 *神秘灵匣',
  '1/5 圣战戒指,50|法神戒指,40|天尊戒指,30',
  '1/15 天魔战甲|圣战战甲',
  '1/1 血煞头盔 1 H $LEVEL > 50',
  '1/1 匕首 1 @触发脚本',
  '#CALL [\\爆率系统\\基础爆率.txt] @武器',
  '坏行没有斜杠',
].join('\r\n'));

const drops = model.items.filter((i) => i.type === 'drop').map((i) => i.line);
ok(drops.length === 6, '解析出 6 条爆率行');
ok(model.items.some((i) => i.type === 'call'), '#CALL 行识别');
ok(model.items.filter((i) => i.type === 'raw').length === 2, '注释+坏行保留为 raw');

ok(drops[0].num === 1 && drops[0].den === 1 && drops[0].p === 1, '1/1 概率 100%');
ok(drops[0].extras === '1000', '数量附加保留');
ok(drops[1].items[0].noBoost === true, '* 前缀识别为不受翻倍');
ok(drops[2].items.length === 3 && drops[2].items[0].weight === 50, '权重解析');
ok(drops[3].items.length === 2 && drops[3].items[0].weight === undefined, '无权重多物品');
ok(drops[4].extras.includes('$LEVEL > 50'), '条件附加保留');
ok(drops[4].extras.indexOf(';') < 0 && drops[4].extras.indexOf('；') < 0, '行尾注释剔除');
ok(drops[5].extras.includes('@触发脚本'), '触发脚本附加保留');

console.log('概率计算:');
const c1 = itemChances(drops[2]);
ok(Math.abs(c1[0].p - 0.2 * 50 / 120) < 1e-9, '权重物品概率 = 行概率×权重占比');
const c2 = itemChances(drops[3]);
ok(Math.abs(c2[0].p - 1 / 15 / 2) < 1e-9, '无权重均分');
const c3 = itemChances(drops[0]);
ok(c3[0].p === 1, '单物品概率 = 行概率');

console.log('序列化 round-trip:');
const text1 = serializeDropFile(model);
const text2 = serializeDropFile(parseDropFile(text1));
ok(text1 === text2, '序列化幂等');
ok(text1.includes('; 注释行'), '注释保留');
ok(text1.includes('坏行没有斜杠'), '坏行保留');
ok(text1.includes('#CALL [\\爆率系统\\基础爆率.txt] @武器'), '#CALL 行保留');
ok(text1.includes('1/200 *神秘灵匣'), '* 标记保留');
ok(text1.includes('1/5 圣战戒指,50|法神戒指,40|天尊戒指,30'), '权重组保留');
ok(text1.includes('1/1 血煞头盔 1 H $LEVEL > 50'), '条件附加保留');

console.log('模拟（确定性随机源）:');
const sim1 = simulateDrops(drops, 1000, seededRand(42));
ok(sim1.perRound.length === 1000, '记录 1000 轮');
ok(sim1.totals['金币'] === 1000, '1/1 金币每轮必出');
const sim2 = simulateDrops(drops, 1000, seededRand(42));
ok(JSON.stringify(sim1.totals) === JSON.stringify(sim2.totals), '同种子结果可复现');
const sim3 = simulateDrops(drops, 100000, seededRand(7));
const ring = (sim3.totals['圣战戒指'] || 0) / 100000;
ok(Math.abs(ring - 0.2 * 50 / 120) < 0.01, '大样本权重物品概率收敛理论值 (' + ring.toFixed(4) + ' ≈ ' + (0.2 * 50 / 120).toFixed(4) + ')');
const totalDrops = Object.values(sim3.totals).reduce((a, b) => a + b, 0);
ok(totalDrops === sim3.perRound.reduce((s, g) => s + g.length, 0), '总计与每轮明细一致');

console.log('翻倍与条件:');
const { hasCondition, isBoostable, boostedP } = require('../out/mapeditor/dropModel');
ok(hasCondition('1 H $LEVEL > 50') && hasCondition('1 G $STR(G99) > 100 -1'), 'H/G 条件识别');
ok(!hasCondition('1000') && !hasCondition('1 @触发脚本'), '数量/触发脚本不算条件');
ok(isBoostable(drops[2]) && !isBoostable(drops[1]), '整组带 * 的行不受翻倍');
ok(boostedP(drops[2], 200) === drops[2].p * 2, '翻倍倍率 200 = 2 倍');
ok(boostedP(drops[1], 200) === drops[1].p, '* 行不翻倍');
ok(boostedP(drops[0], 500) === 1, '概率封顶 100%');

const condLine = drops[4]; // 1/1 血煞头盔 1 H $LEVEL > 50
const simC = simulateDrops([condLine], 100, seededRand(1), { conditionsPass: false });
ok(Object.keys(simC.totals).length === 0, '条件关闭时条件行不掉落');
const simM = simulateDrops(drops, 1000, seededRand(42), { mult: 100 });
ok(JSON.stringify(simM.totals) === JSON.stringify(sim1.totals), '倍率 100 与默认行为一致');
const simX2 = simulateDrops([drops[1]], 100000, seededRand(9), { mult: 1000 });
const starRate = (simX2.totals['神秘灵匣'] || 0) / 100000;
ok(Math.abs(starRate - 0.005) < 0.002, '* 物品在 10 倍率下仍按原爆率 (' + starRate.toFixed(4) + ')');

console.log('\n全部通过: ' + passed + ' 项');
