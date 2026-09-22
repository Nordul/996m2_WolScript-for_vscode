/* 用 vscode-textmate + oniguruma 验证语法高亮分词: node scripts/grammartest.js */
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const onig = require('vscode-oniguruma');

const wasmBin = fs.readFileSync(path.join(__dirname, '../node_modules/vscode-oniguruma/release/onig.wasm')).buffer;

const lines = [
  '[@main]',
  '#IF',
  'CHECK [8] 0',
  'EQUAL D0 1',
  '#ACT',
  'MOV S0 欢迎来到996传世',
  'SENDMSG 5 欢迎回来,<$USERNAME>!',
  '#SAY',
  '你好,<$USERNAME>! 你的等级是 <$LEVEL>,金币 <$GOLDCOUNT>',
  '\\<返回/@main\\>',
  'MOV A0 $STR(D5)',
  'VAR String Human MyLover',
  'CALCVAR Human MyLover = 小红',
  'CLEARVAR S1 5',
  'Inc s$Ui <RText|x=2.6|y=6.5|color=255|size=18|text=元宝:<$Money(2)> 金币:<$Money(1)>>',
  'Mov s$Ui <Button|x=303.6|link=@CloseSendUI>',
  '#IFONE',
  '!CHECKITEM <$STR(S$羽翼升级_消耗材料1)> 1',
  'EQUAL <$STR(S$羽翼升级_羽翼进度)> 0',
  '!SMALL <$STR(N$羽翼升级_消耗材料)> 2',
  'MESSAGEBOX 至少填入一个',
  'LARGE <$DEC^<$STR(N$羽翼升级_消耗材料)>^10> 0',
  'DEC N$羽翼升级_消耗材料 10',
  'SENDMSG 5 消耗:<$PERMILL.<$STR(N$材料)>.100>',
  'MONEY 金币 = 100',
  '!CHECKMONEY 1 < 100',
  '!CHECKBINDMONEY 绑元 > 10',
  'SENDMSG 5 绑元:<$BINDMONEY(绑元)>',
  '#CALL [\\商城\\回收.txt] @回收',
  'SENDMSG 5 价格:<$cfg_物品价格(1_7)>',
  'SENDMSG 5 官职:<$cfg_guanzhi(1_<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>)>',
];

async function main() {
  await onig.loadWASM(wasmBin);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new onig.OnigScanner(sources),
      createOnigString: (s) => new onig.OnigString(s),
    }),
    loadGrammar: async (scope) => {
      if (scope === 'source.m2script') {
        const raw = fs.readFileSync(path.join(__dirname, '../syntaxes/m2script.tmLanguage.json'), 'utf8');
        return vsctm.parseRawGrammar(raw, 'm2script.tmLanguage.json');
      }
      return null;
    },
  });
  const grammar = await registry.loadGrammar('source.m2script');

  // 断言: [行号(0基), 子串, 期望scope包含]
  const expect = [
    [0, '[@main]', 'entity.name.type.label'],
    [8, '<$USERNAME>', 'support.variable.system'],
    [9, '@main', 'entity.name.type.label'],
    [11, 'VAR', 'support.function.command'],
    [11, 'String', 'storage.type'],
    [11, 'Human', 'storage.modifier'],
    [11, 'MyLover', 'entity.name.variable.custom'],
    [12, 'CALCVAR', 'support.function.command'],
    [12, 'MyLover', 'entity.name.variable.custom'],
    [14, 'Inc', 'support.function.command'],
    [14, '<$Money(', 'support.variable.system'],
    [15, 'Mov', 'support.function.command'],
    [15, '@CloseSendUI', 'entity.name.type.label'],
    [16, '#IFONE', 'keyword.control.section'],
    [17, '!', 'keyword.operator.logical.not'],
    [17, 'CHECKITEM', 'support.function.command'],
    [17, 'S$羽翼升级_消耗材料1', 'variable.other.named'],
    [18, 'S$羽翼升级_羽翼进度', 'variable.other.named'],
    [19, '!', 'keyword.operator.logical.not'],
    [19, 'SMALL', 'support.function.command'],
    [19, 'N$羽翼升级_消耗材料', 'variable.other.named'],
    [20, 'MESSAGEBOX', 'support.function.command'],
    [21, '<$DEC', 'support.variable.system'],
    [21, 'N$羽翼升级_消耗材料', 'variable.other.named'],
    [22, 'DEC', 'support.function.command'],
    [22, 'N$羽翼升级_消耗材料', 'variable.other.named'],
    [23, '<$PERMILL', 'support.variable.system'],
    [24, 'MONEY', 'support.function.command'],
    [25, 'CHECKMONEY', 'support.function.command'],
    [26, 'CHECKBINDMONEY', 'support.function.command'],
    [26, '!', 'keyword.operator.logical.not'],
    [27, '<$BINDMONEY(', 'support.variable.system'],
    [28, '#CALL', 'support.function.command'],
    [28, '[\\商城\\回收.txt]', 'string.other.path'],
    [28, '@回收', 'entity.name.type.label'],
    [29, '<$cfg_物品价格(1_7)>', 'support.variable.system'],
    [30, '<$cfg_guanzhi(1_<$GetTypeBRow(cfg_guanzhi,4,GUANJIAN)>', 'support.variable.system'],
  ];

  let fail = 0;
  const allTokens = [];
  let ruleStack = null;
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, ruleStack);
    ruleStack = r.ruleStack;
    allTokens.push(r.tokens.map((t) => ({
      text: line.substring(t.startIndex, t.endIndex),
      scope: t.scopes.filter((s) => !s.startsWith('meta.') && s !== 'source.m2script').pop() || '(无)',
    })));
  }
  lines.forEach((line, i) => {
    console.log('\n>>> ' + line);
    for (const t of allTokens[i]) console.log(`  [${t.text}] => ${t.scope}`);
  });
  console.log('\n==== 断言 ====');
  for (const [ln, sub, scope] of expect) {
    const tok = allTokens[ln].find((t) => t.text === sub || t.text.includes(sub));
    const ok = tok && tok.scope.includes(scope);
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} 行${ln + 1} [${sub}] 期望 ${scope}, 实际 ${tok ? tok.scope : '未找到'}`);
  }
  if (fail) { console.error(`${fail} 项失败`); process.exit(1); }
  console.log('全部通过');
}
main().catch((e) => { console.error(e); process.exit(1); });
