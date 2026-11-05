/* 静态检查核心自测: node scripts/diagnosticstest.js (需先 npm run compile) */
const assert = require('assert');
const { lintScript } = require('../out/providers/diagnosticsCore');

const valid = lintScript(`[@main]
#IF
CHECKITEM 回城石 1
!EQUAL D0 1
COMPARETEXT S0 测试
POSINLIST S0 ..\\QuestDiary\\名单.txt
#ACT
GIVE 回城石 1
MOV S0 <$STR(S0)>
SET [8] 1
#SAY
你好，勇士。这里可以写（中文标点），也可以写[任意文本。
; GIVE 木剑 1，注释不检查
  // MOV D0 1，注释也不检查
#ELSEACT
MOV D0 1 // 行尾注释，不检查
`);
assert.deepStrictEqual(valid, [], '合法脚本、对话及注释不应产生诊断');

const curlyBlock = lintScript(`[@XX]
{
#SAY
外层内容
[@XX1]
#SAY
嵌套标签一
[@XX2]
#SAY
嵌套标签二
}
`);
assert.deepStrictEqual(curlyBlock, [], '跨行花括号块允许嵌套标签，且右括号可位于SAY段之后');

const wrongSection = lintScript(`#IF
GIVE 木剑 1
#ACT
CHECKITEM 回城石 1
#ELSEACT
EQUAL D0 1
#IFONE
MOV D0 1
`);
assert.deepStrictEqual(wrongSection.map((d) => d.code), [
  'action-in-if', 'check-in-act', 'check-in-act', 'action-in-if',
]);
assert.strictEqual(wrongSection[0].line, 1);
assert.strictEqual(wrongSection[0].start, 0);
assert.strictEqual(wrongSection[0].end, 4);
assert(wrongSection[0].message.includes('#ACT'));
assert(wrongSection[1].message.includes('#IF'));

const callSection = lintScript(`#IF
#CALL [\\QuestDiary\\测试.txt] @测试
#ACT
#CALL [\\QuestDiary\\测试.txt] @测试
`);
assert.deepStrictEqual(callSection.map((d) => d.code), ['action-in-if'], '#CALL是ACT命令');
assert.strictEqual(callSection[0].line, 1);
assert.strictEqual(callSection[0].start, 0);
assert.strictEqual(callSection[0].end, 5);

const outsideSection = lintScript(`MOV D0 1
[@XX]
CHECKITEM 回城石 1
#CALL [\\QuestDiary\\测试.txt] @测试
COMPARETEXT S0 测试
#SAY
MOV D0 1
[@XX1]
UNKNOWNCOMMAND D0 1
`);
assert.deepStrictEqual(outsideSection.map((d) => d.code), [
  'command-outside-section', 'command-outside-section', 'command-outside-section', 'command-in-say',
]);
assert(outsideSection[0].message.includes('#ACT'));
assert(outsideSection[1].message.includes('#IF'));
assert(outsideSection[2].message.includes('#IF'));
assert(outsideSection[3].message.includes('对话文本'));

const sayCommands = lintScript(`#SAY
CHECKITEM 回城石 1
#ELSESAY
#CALL [\\QuestDiary\\测试.txt] @测试
COMPARETEXT S0 测试
普通对话内容
`);
assert.deepStrictEqual(sayCommands.map((d) => d.code), Array(3).fill('command-in-say'));
assert(sayCommands[0].message.includes('#IF'));
assert(sayCommands[1].message.includes('#ACT'));
assert.deepStrictEqual(lintScript('[@XX]\n#CALL [\\QuestDiary\\测试.txt] @测试'), [], '标签下允许直接调用#CALL');
assert.deepStrictEqual(
  lintScript('#CALL [\\游戏功能\\人物升级.txt] @人物升级\n#CALL [\\游戏功能\\怪物触发.txt] @怪物触发'),
  [],
  'QFunction等文件顶部允许直接写#CALL',
);

const standaloneVariables = lintScript(`#IF
$CustomValue(95)
#ACT
<$M>
MOV S0 <$M>
#IF
EQUAL <$CUSTOMVALUE(95)> 1
#SAY
<$M>
`);
assert.deepStrictEqual(standaloneVariables.map((d) => d.code), ['standalone-variable', 'standalone-variable']);
assert.strictEqual(standaloneVariables[0].line, 1);
assert.strictEqual(standaloneVariables[1].line, 3);
assert(standaloneVariables[0].message.includes('不能单独作为命令'));

const brackets = lintScript(`#ACT
MOV S0 <$STR(S0>
MOV S1 [8
MOV S2 测试)
MOV S3 [测试)
`);
assert.deepStrictEqual(brackets.map((d) => d.code), [
  'unclosed-bracket', 'unclosed-bracket', 'unmatched-bracket', 'unmatched-bracket',
]);
assert.strictEqual(brackets[0].start, 12, '应定位到未闭合的左括号');
assert.strictEqual(brackets[1].start, 7);
assert.strictEqual(brackets[2].start, 9);
assert(brackets[3].message.includes(']'));
assert.deepStrictEqual(lintScript('[@XXX]\n{').map((d) => d.code), ['unclosed-bracket']);
assert.deepStrictEqual(lintScript('[@XXX]\n}').map((d) => d.code), ['unmatched-bracket']);

const punctuationSource = `#IF
CHECKITEM 回城石，1
#ACT
MOV S0 测试。
MOV S1　1
MOV S2 （测试）
`;
const punctuation = lintScript(punctuationSource);
assert.deepStrictEqual(punctuation.map((d) => d.code), Array(5).fill('fullwidth-punctuation'));
assert.deepStrictEqual(punctuation.map((d) => d.start), [13, 9, 6, 7, 10]);
assert(punctuation[0].message.includes('，'));
assert(punctuation[0].message.includes(','));
assert(punctuation[2].message.includes('全角空格'));
assert.deepStrictEqual(lintScript(punctuationSource, { fullwidthPunctuation: false }), [], '关闭后不应报告全角标点');
assert.deepStrictEqual(
  lintScript('#IF\nGIVE 木剑，1', { fullwidthPunctuation: false }).map((d) => d.code),
  ['action-in-if'],
  '关闭全角标点检查不影响其他规则',
);

console.log('diagnosticstest 全部通过 ✔');
