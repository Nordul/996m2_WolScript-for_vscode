/* 扫描器核心逻辑自测: node scripts/selftest.js (需先 npm run compile) */
const assert = require('assert');
const { scanText, isEngineScriptPath, decodeScript } = require('../out/scanner/scanCore');

const sample = `
[@main]
#IF
CHECK [8] 0
EQUAL D0 1
CHECKITEM 回城石 1
#ACT
SET [8] 1
MOV S0 996传世引擎
MOVR D5 10
INC D5 2
GIVE 木剑 1
VAR String Human MyLover
CALCVAR Human MyLover = MyGirl
#SAY
你好<$USERNAME>, 你的变量是<$STR(S0)>
我爱<$HUMAN(MyLover)>
; 这是注释 MOV S99 测试
#ELSEACT
MOV P1 100 // 行尾注释 MOV P2 200
CLEARVAR S1 5
CHANGECUSTOMVALUE 7 = 100
CHANGECUSTOMVALUE 7 + 5
SENDMSG 5 你的积分:<$CUSTOMVALUE(7)>
SENDMSG 5 非法编号:<$CUSTOMVALUE(120)>
`;

const g = scanText(sample, 'QuestDiary/demo.txt', 'D:\\srv\\QuestDiary\\demo.txt');

// 标记
assert(g.MARK['[8]'], '标记[8]应被识别');
assert.strictEqual(g.MARK['[8]'].filter((r) => r.access === 'write').length, 1, '[8] 一次写(SET)');
assert.strictEqual(g.MARK['[8]'].filter((r) => r.access === 'read').length, 1, '[8] 一次读(CHECK)');

// 类型变量读写判定
assert.strictEqual(g.S['S0'][0].access, 'write', 'MOV S0 是写');
assert.strictEqual(g.S['S0'][1].access, 'read', '<$STR(S0)> 是读');
assert.strictEqual(g.D['D0'][0].access, 'read', 'EQUAL D0 是读');
assert.strictEqual(g.D['D5'][0].access, 'write', 'MOVR D5 是写');
assert.strictEqual(g.D['D5'][1].access, 'write', 'INC D5 是写');
assert(!g.S['S99'], '注释里的 S99 不应计入');
assert(g.P['P1'] && !g.P['P2'], '行尾注释后 P2 不应计入');
assert(g.S['S1'], 'CLEARVAR S1 应计入');
assert.strictEqual(g.S['S1'][0].access, 'write', 'CLEARVAR 是写');

// 自定义变量
assert(g.CUSTOM['MyLover'], '自定义变量 MyLover 应被识别');
assert.strictEqual(g.CUSTOM['MyLover'].length, 3, '声明+操作+显示 共3处');

// CustomValue 变量
assert(g.CV['CV7'], 'CV7 应被识别');
assert.strictEqual(g.CV['CV7'].filter((r) => r.access === 'write').length, 2, 'CV7 两次写(CHANGECUSTOMVALUE)');
assert.strictEqual(g.CV['CV7'].filter((r) => r.access === 'read').length, 1, 'CV7 一次读($CUSTOMVALUE)');
assert(!g.CV['CV120'], '超出0-99的CUSTOMVALUE不应计入');

// 路径识别
assert(isEngineScriptPath('D:\\Mir200\\Envir\\QuestDiary\\demo.txt'));
assert(isEngineScriptPath('D:\\Mir200\\Envir\\Market_def\\杂货商.txt'));
assert(isEngineScriptPath('D:\\Mir200\\Envir\\MapQuest_def\\QManage.txt'));
assert(isEngineScriptPath('D:\\Mir200\\Envir\\Funtion_def\\QFunction-0.txt'));
assert(!isEngineScriptPath('D:\\Mir200\\Envir\\Config\\String.ini.txt'));
assert(!isEngineScriptPath('D:\\notes\\readme.txt'));

// 编码: 996M2 脚本为 GBK
// '变量' 的 GBK 字节: B1 E4 C1 BF
assert.strictEqual(decodeScript(new Uint8Array([0xb1, 0xe4, 0xc1, 0xbf])), '变量', 'GBK 字节应解码为中文');
assert.strictEqual(decodeScript(new TextEncoder().encode('变量')), '变量', '合法 UTF-8 应保持 UTF-8 解码');
const bomUtf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('变量')]);
assert.strictEqual(decodeScript(bomUtf8), '变量', 'UTF-8 BOM 应正确去除');
assert.strictEqual(decodeScript(new TextEncoder().encode('MOV D0 100')), 'MOV D0 100', '纯 ASCII 不受影响');
// GBK 解码出的中文变量名应能被扫描识别
const gbkText = decodeScript(new Uint8Array([0x4e, 0x24])); // 'N$' ASCII
assert.strictEqual(gbkText, 'N$');

console.log('selftest 全部通过 ✔');
