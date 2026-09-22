# 996M2 传世脚本工具 (m2script-tools)

996M2 传世引擎脚本语言的 VSCode 支持插件：语法高亮、上下文感知补全、悬停文档、变量占用查询、断点调试。

命令数据来自 [996传世引擎在线文档](http://cshelp.996m2.com/web/#/17/1210) 全量爬取（479 条执行命令、189 条检测命令、250+ 系统变量、23 个 UI 组件、139 个触发器）。

## 功能

### 语法高亮
- 段标记 `#IF/#IFONE/#ACT/#SAY/#ELSEACT/#ELSESAY`、标签 `[@xxx]`、跳转 `/@xxx`
- 脚本命令与检测命令（含 `!` 前缀取反）、类型变量（`S0`/`A12`/`D5`…）、命名变量（`N$羽翼升级`）、个人标记 `[8]`
- 系统变量 `<$USERNAME>`、取值语法 `<$STR(S0)>`、嵌套表达式 `<$DEC^<$STR(N$x)>^10>`
- UI 组件 `<Text|…>` `<Button|…>`（组件名/参数名/参数值独立着色）

### 上下文感知补全
- `#IF` 段仅提示检测命令（CHECKITEM、EQUAL…），`#ACT` 段仅提示执行命令（MOV、GIVE…），`#SAY` 段提示显示变量与 UI 组件
- `<` 触发系统变量与 UI 组件补全，`@` 触发标签/触发器补全，`#` 触发段标记，`!` 触发取反检测命令
- 补全按已输入前缀过滤排序，而非固定 A-Z 全量列表
- `SENDMSG` 命令智能补全：A 字段弹出编号列表（附各编号用途说明），选择后自动 Tab 到 B 字段

### 悬停文档
命令、检测命令、系统变量、UI 组件、类型变量（含超范围警告），附官方文档链接。

### 跳转与导航
- `GOTO @标签`、`#CALL [文件] @标签`、`/@xxx` 链接：Ctrl+点击 跳转到对应标签
- `#CALL [\目录\文件.txt]`：跳转到 QuestDiary 下对应文件
- `<$cfg_名称(行_列)>`：跳转到 `cfg_名称.csv` 对应单元格（含变量时仅打开文件）
- `[@标签]` 折叠：点击折叠整个标签段

### 颜色调整
`color=224`（0-255 颜色卡）、`#0xffffa500`、`ffa500`（16 进制颜色）均有颜色标识，点击可调出取色器直接修改。

### 已占用变量查询
侧边栏「996脚本」面板，全工作区扫描 A/S/P/D/G/I/M/U/T/J/Z 变量、个人标记 `[n]`、CustomValue（CV0-99）、自定义变量（`VAR` 声明），按类型分组、读写统计、点击跳转到占用位置。

### 断点调试（内置脚本模拟器）
引擎无远程调试接口，插件内置脚本解释器，通过 VSCode 原生调试界面调试：

- 打开脚本按 **F5** 启动，支持断点、单步（F10/F11/Shift+F11）、变量窗口（按变量类型分组）、Watch 求值、调用堆栈
- 真实模拟：`MOV/INC/DEC/CALCVAR/VAR/SET/CHANGECUSTOMVALUE` 等变量命令、`EQUAL/LARGE/SMALL/CHECK/CHECKVAR` 条件、`GOTO`、`#CALL` 跨文件、`LoopGoto`（含 `@标签_END` 约定与 STOP/BREAK 退出）、`FOR/ENDFOR`、`DelayCall/DelayGoto`（立即调用模拟）
- 字符串变量上 `INC` 为拼接（SendUi 拼 UI 字符串写法）
- 游戏状态取值（`CHECKITEM`、`<$LEVEL>` 等）执行到时弹窗现场输入，会话内缓存
- 条件检测结果逐条输出到调试控制台，分支走向一目了然
- `presetVars` 启动配置可预设变量值，用于进入依赖游戏状态的分支；`maxSteps` 防死循环（默认 10 万步）
- 副作用命令（GIVE/TAKE 等）不模拟，控制台输出"已跳过"；`#SAY` 文本输出为 NPC 对话预览

## 文件识别与编码

以下路径/文件名的 `.txt` 自动识别为 996 脚本（默认 GBK 编码打开）：

- `QuestDiary`、`Market_def`、`Npc_def`、`MapQuest_def`、`Robot_def`、`Funtion_def` 目录下的所有 `.txt`
- `QFunction-*.txt`、`QManage*.txt`、`QWolShop-*.txt`、`RobotManage.txt`、`AutoRunRobot.txt`
- 其他 `.txt` 若内容包含 `[@标签]`、`#IF` 等脚本特征会自动识别；也可用编辑器右上角命令「996脚本: 将当前文件识别为996脚本」手动切换
- 检测到乱码（未按 GBK 打开）时会提示重新以 GBK 编码打开

## 安装

 Releases 页面下载 `m2script-tools-x.x.x.vsix`，执行：

```bash
code --install-extension m2script-tools-x.x.x.vsix
```

或在 VSCode 扩展面板 `...` → `Install from VSIX...`。

## 开发

```bash
npm install
npm run compile      # 编译 (tsc)
npm run crawl        # 重新爬取官方文档生成命令库
npm run selftest     # 扫描器 + 语法 + 解释器自测
node scripts/completiontest.js   # 补全/跳转/折叠/颜色等 mock 测试
node scripts/daptest.js          # 调试适配器 DAP 消息流模拟测试
```

打包：`npx vsce package --no-dependencies`

## 目录结构

- `syntaxes/m2script.tmLanguage.json` — TextMate 语法（由 `scripts/build-grammar.js` 生成，勿手改）
- `src/data/*.json` — 爬取生成的命令/变量/组件库
- `src/providers/` — 补全、悬停、跳转、折叠、颜色
- `src/scanner/` — 变量占用扫描（`scanCore.ts` 为纯逻辑，可独立自测）
- `src/debug/` — 调试器：`scriptModel.ts` 脚本解析、`interpreter.ts` 解释器核心（纯逻辑）、`adapter.ts` DAP 适配器、`configProvider.ts` 调试配置
- `src/views/varPanel.ts` — 侧边栏变量面板
- `example/` — 示例脚本

## License

MIT
