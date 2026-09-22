/* 脚本解释器自测: node scripts/interpretertest.js (需先 npm run compile) */
const assert = require('assert');
const { Interpreter } = require('../out/debug/interpreter');

let fail = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('PASS ' + name))
    .catch((e) => {
      fail++;
      console.log('FAIL ' + name + ': ' + e.message);
    });
}

const ENTRY = 'D:\\srv\\QuestDiary\\main.txt';

function makeInterp(entryText, opts = {}) {
  const outputs = [];
  const askLog = { check: [], value: [] };
  const interp = new Interpreter({
    entryFile: ENTRY,
    entryText,
    loadFile: async (rel) => {
      const t = (opts.files || {})[rel];
      return t === undefined ? undefined : { fileKey: 'D:\\srv\\QuestDiary\\' + rel, text: t };
    },
    loadCsv: async (name) => (opts.csv || {})[name],
    ask: {
      askCheck: async (expr) => {
        askLog.check.push(expr);
        return (opts.checks || {})[expr] ?? true;
      },
      askValue: async (expr, prev) => {
        askLog.value.push(expr);
        return (opts.values || {})[expr] ?? '0';
      },
    },
    onOutput: (t) => outputs.push(t),
    maxSteps: opts.maxSteps,
  });
  return { interp, outputs, askLog };
}

(async () => {
  // 1. 算术与变量读写
  await check('MOV/INC/DEC/CALCVAR 算术', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV D5 10
INC D5 2
DEC D5 3
MOV A0 你好
VAR String Human MyLover
CALCVAR Human MyLover = 小红
BREAK
`);
    const stop = await interp.run('continue');
    assert.strictEqual(stop, null, '应执行完毕');
    assert.strictEqual(interp.evaluate('D5'), '9');
    assert.strictEqual(interp.evaluate('A0'), '你好');
    assert.strictEqual(interp.evaluate('<$HUMAN(MyLover)>'), '小红');
  });

  // 2. 命名变量与嵌套函数
  await check('命名变量 + <$DEC^<$STR(N$x)>^10> 嵌套', async () => {
    const { interp, outputs } = makeInterp(`[@main]
#IF
#ACT
MOV N$羽翼升级_消耗材料 10
SENDMSG 5 剩余<$DEC^<$STR(N$羽翼升级_消耗材料)>^10>
BREAK
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('N$羽翼升级_消耗材料'), '10');
    assert(outputs.some((t) => t.includes('剩余0')), 'SENDMSG 应输出 剩余0, 实际: ' + outputs.join('|'));
  });

  // 3. 条件分支
  await check('#IF 失败走 #ELSEACT', async () => {
    const { interp } = makeInterp(`[@main]
#IF
EQUAL D0 1
#ACT
MOV D9 1
#ELSEACT
MOV D9 2
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D9'), '2');
  });

  await check('#IFONE 的 OR 语义', async () => {
    const { interp } = makeInterp(`[@main]
#IFONE
FALSE
TRUE
#ACT
MOV D9 5
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D9'), '5');
  });

  await check('!CHECK 取反 + SET 标记', async () => {
    const { interp } = makeInterp(`[@main]
#IF
!CHECK [8] 0
#ACT
MOV D1 1
#ELSEACT
MOV D1 0
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D1'), '0', '标记[8]默认0, !CHECK [8] 0 应为假');

    const { interp: i2 } = makeInterp(`[@main]
#IF
#ACT
SET [8] 1
GOTO @next
[@next]
#IF
!CHECK [8] 0
#ACT
MOV D1 1
`);
    await i2.run('continue');
    assert.strictEqual(i2.evaluate('D1'), '1', 'SET [8] 1 后 !CHECK [8] 0 应为真');
  });

  // 4. GOTO 与死循环保护
  await check('GOTO 跳转', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV D0 0
GOTO @skip
MOV D0 99
[@skip]
#IF
#ACT
INC D0 1
BREAK
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D0'), '1');
  });

  await check('GOTO 死循环触发 maxSteps 保护', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
GOTO @main
`, { maxSteps: 500 });
    const stop = await interp.run('continue');
    assert(stop && stop.reason === 'maxSteps', '应以 maxSteps 暂停, 实际: ' + JSON.stringify(stop));
  });

  // 5. #CALL 跨文件
  const libText = `[@func]
#IF
#ACT
INC D0 100
BREAK
`;
  const callMain = `[@main]
#IF
#ACT
MOV D0 1
#CALL [\\sub\\lib.txt] @func
INC D0 10
BREAK
`;

  await check('#CALL 跨文件执行并返回', async () => {
    const { interp } = makeInterp(callMain, { files: { '\\sub\\lib.txt': libText } });
    const stop = await interp.run('continue');
    assert.strictEqual(stop, null);
    assert.strictEqual(interp.evaluate('D0'), '111');
  });

  await check('#CALL 缺失文件仅警告不崩溃', async () => {
    const { interp, outputs } = makeInterp(callMain);
    await interp.run('continue');
    assert(outputs.some((t) => t.includes('不存在')), '应输出文件不存在警告');
    assert.strictEqual(interp.evaluate('D0'), '11');
  });

  // 6. LoopGoto
  await check('LoopGoto 循环次数 + @_END 自动进入', async () => {
    const { interp, outputs } = makeInterp(`[@main]
#IF
#ACT
MOV P2 0
LoopGoto @A 3
SENDMSG 7 done<$STR(P2)>
BREAK
[@A]
#IF
#ACT
INC P2 1
[@A_END]
#IF
#ACT
INC P2 100
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('P2'), '103');
    assert(outputs.some((t) => t.includes('done103')), '输出应为 done103: ' + outputs.join('|'));
  });

  await check('LoopGoto 内 STOP 退出循环层并进入 _END', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV P3 0
LoopGoto @B 10
BREAK
[@B]
#IF
SMALL P3 2
#ACT
INC P3 1
#ELSEACT
STOP
[@B_END]
#IF
#ACT
INC P3 100
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('P3'), '102');
  });

  await check('LoopGoto 内 BREAK 退出循环层(不进 _END)', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV P4 0
LoopGoto @C 10
BREAK
[@C]
#IF
#ACT
INC P4 1
BREAK
[@C_END]
#IF
#ACT
INC P4 100
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('P4'), '1');
  });

  // 7. FOR/ENDFOR
  await check('FOR/ENDFOR 条件循环', async () => {
    const { interp, outputs } = makeInterp(`[@main]
#IF
#ACT
MOV M1 1
FOR M1 > 5
INC M1 1
ENDFOR
SENDMSG 5 循环结束<$STR(M1)>
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('M1'), '6');
    assert(outputs.some((t) => t.includes('循环结束6')));
  });

  // 8. DelayCall 立即调用
  await check('DelayCall 模拟为立即调用并可返回', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV D0 0
DelayCall 3 @test
INC D0 10
BREAK
[@test]
#IF
#ACT
INC D0 1
BREAK
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D0'), '11');
  });

  // 9. 断点与单步
  await check('断点命中与 continue', async () => {
    const { interp } = makeInterp(callMain, { files: { '\\sub\\lib.txt': libText } });
    interp.setBreakpoints(ENTRY, [5]);
    const stop = await interp.run('continue');
    assert(stop && stop.reason === 'breakpoint' && stop.line === 5, '应在第5行断点: ' + JSON.stringify(stop));
    assert.strictEqual(interp.evaluate('D0'), '101', '断点停在该行执行前');
    const stop2 = await interp.run('continue');
    assert.strictEqual(stop2, null);
    assert.strictEqual(interp.evaluate('D0'), '111');
  });

  await check('stepIn 进入 #CALL / stepOut 返回 / next 越过', async () => {
    const { interp } = makeInterp(callMain, { files: { '\\sub\\lib.txt': libText } });
    let s = await interp.run('entry');
    assert(s && s.reason === 'entry' && s.line === 0);
    s = await interp.run('next'); // #IF
    assert(s.line === 1);
    s = await interp.run('next'); // #ACT
    assert(s.line === 2);
    s = await interp.run('next'); // MOV
    assert(s.line === 3);
    s = await interp.run('next'); // 到达 #CALL 行
    assert(s.line === 4);
    s = await interp.run('stepIn'); // 进入 #CALL
    assert(s.reason === 'step' && s.file.endsWith('lib.txt') && s.line === 0, 'stepIn 应停在 lib 标签行: ' + JSON.stringify(s));
    assert.strictEqual(interp.stackTrace().length, 2, '调用栈应为2层');
    s = await interp.run('stepOut');
    assert(s.file === ENTRY && s.line === 5, 'stepOut 应回到主文件第5行: ' + JSON.stringify(s));
    s = await interp.run('next');
    assert(s.line === 6);
    s = await interp.run('continue');
    assert.strictEqual(s, null);
    assert.strictEqual(interp.evaluate('D0'), '111');
  });

  await check('next 越过 #CALL 不进入', async () => {
    const { interp } = makeInterp(callMain, { files: { '\\sub\\lib.txt': libText } });
    interp.setBreakpoints(ENTRY, [4]);
    let s = await interp.run('continue');
    assert(s.line === 4);
    s = await interp.run('next');
    assert(s.file === ENTRY && s.line === 5, 'next 应停在 #CALL 下一行: ' + JSON.stringify(s));
    assert.strictEqual(interp.evaluate('D0'), '101');
  });

  // 10. 询问回调与游戏状态缓存
  await check('CHECKITEM 询问 + <$LEVEL> 缓存复用', async () => {
    const { interp, askLog } = makeInterp(`[@main]
#IF
CHECKITEM 回城石 1
#ACT
MOV D0 <$LEVEL>
INC D0 <$LEVEL>
BREAK
`, { checks: { 'CHECKITEM 回城石 1': true }, values: { '<$LEVEL>': '50' } });
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('D0'), '100');
    assert.deepStrictEqual(askLog.check, ['CHECKITEM 回城石 1']);
    assert.strictEqual(askLog.value.filter((e) => e === '<$LEVEL>').length, 1, '<$LEVEL> 应只询问一次(缓存)');
  });

  // 11. CustomValue
  await check('CHANGECUSTOMVALUE + <$CUSTOMVALUE(n)>', async () => {
    const { interp, outputs } = makeInterp(`[@main]
#IF
#ACT
CHANGECUSTOMVALUE 7 = 100
CHANGECUSTOMVALUE 7 + 5
SENDMSG 5 cv=<$CUSTOMVALUE(7)>
`);
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('<$CUSTOMVALUE(7)>'), '105');
    assert(outputs.some((t) => t.includes('cv=105')));
  });

  // 12. cfg csv 读取
  await check('<$cfg_名称(行_列)> 读取 csv', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV S0 <$cfg_test(1_2)>
BREAK
`, { csv: { test: 'a,b,c\nd,e,f' } });
    await interp.run('continue');
    assert.strictEqual(interp.evaluate('S0'), 'f');
  });

  // 13.5 文件首部注释/空行不应导致误判段结束(真实 bug 回归)
  await check('首部注释的脚本 entry 暂停与断点命中', async () => {
    const { interp } = makeInterp(`; 996M2 传世脚本示例
; 第二行注释

[@main]
#IF
#ACT
MOV D0 1
INC D0 2
BREAK
`);
    interp.setBreakpoints(ENTRY, [7]);
    let s = await interp.run('entry');
    assert(s && s.reason === 'entry' && s.line === 3, 'entry 应停在 [@main] 行: ' + JSON.stringify(s));
    s = await interp.run('continue');
    assert(s && s.reason === 'breakpoint' && s.line === 7, '应命中第7行断点: ' + JSON.stringify(s));
    s = await interp.run('continue');
    assert.strictEqual(s, null);
    assert.strictEqual(interp.evaluate('D0'), '3');
  });

  // 14. 变量快照分组
  // 14.5 字符串变量 INC 拼接 UI 字符串(含空格与 <$Money> 原样保留)
  await check('INC 拼接字符串变量(SendUi 场景)', async () => {
    const { interp } = makeInterp(`[@main]
#IF
True
#ACT
Mov s$Ui <Button|x=303.6|y=-4.9|nimg=public/button/btn_close_01.png|_localZOrder=0|pimg=public/button/btn_close_01.png|link=@CloseSendUI>
Inc s$Ui <RText|x=2.6|y=6.5|color= 255|size=18|text=元宝:<$Money(2)>金币:<$Money(1)>>
Inc s$Ui <Img|x=10|y=10|img=public/00000361.png|scale=1>
SendUi 101 <$Str(s$Ui)>
Break
`);
    await interp.run('continue');
    assert.strictEqual(
      interp.evaluate('S$Ui'),
      '<Button|x=303.6|y=-4.9|nimg=public/button/btn_close_01.png|_localZOrder=0|pimg=public/button/btn_close_01.png|link=@CloseSendUI>' +
        '<RText|x=2.6|y=6.5|color= 255|size=18|text=元宝:<$Money(2)>金币:<$Money(1)>>' +
        '<Img|x=10|y=10|img=public/00000361.png|scale=1>',
      's$Ui 应为三段 UI 字符串的拼接(含空格, <$Money> 原样保留)',
    );
  });
  await check('变量快照只含被读写的变量并分组', async () => {
    const { interp } = makeInterp(`[@main]
#IF
#ACT
MOV D5 1
MOV G3 2
SET [8] 1
MOV N$测试 3
`);
    await interp.run('continue');
    const vars = interp.snapshotVars();
    const groups = new Set(vars.map((v) => v.group));
    assert(groups.has('个人变量') && groups.has('全局变量') && groups.has('个人标记') && groups.has('命名变量'), '分组: ' + [...groups]);
    assert(!vars.some((v) => v.name === 'D6'), '未使用的 D6 不应出现');
  });

  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
