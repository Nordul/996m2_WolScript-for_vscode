# 996传世脚本 996WolScript

996 传世引擎脚本语言的 VSCode 支持插件：语法高亮、上下文感知补全、悬停文档、跳转导航、变量占用查询、断点调试，以及地图 / 刷怪 / NPC / 爆率的可视化管理。

[![GitHub](https://img.shields.io/badge/GitHub-996WolScript-6366f1)](https://github.com/Nordul/996m2_WolScript-for_vscode)
[![Release](https://img.shields.io/github/v/release/Nordul/996m2_WolScript-for_vscode)](https://github.com/Nordul/996m2_WolScript-for_vscode/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

命令数据来自 [996 传世引擎在线文档](http://cshelp.996m2.com/web/#/17/1210) 全量爬取：**479** 条执行命令、**189** 条检测命令、**250+** 系统变量、**23** 个 UI 组件、**139** 个触发器。

---

## 功能特性

### 语法高亮

- 段标记 `#IF` `#IFONE` `#ACT` `#SAY` `#ELSEACT` `#ELSESAY`、标签 `[@xxx]`、跳转 `/@xxx`
- 执行/检测命令（含 `!` 前缀取反）、类型变量（`S0` `A12` `D5`…）、命名变量（`N$羽翼升级`）、个人标记 `[8]`
- 系统变量 `<$USERNAME>`、取值语法 `<$STR(S0)>`、嵌套表达式 `<$DEC^<$STR(N$x)>^10>`
- UI 组件 `<Text|…>` `<Button|…>`，组件名 / 参数名 / 参数值独立着色

### 相同词高亮

- 光标所在词在当前文件内整词高亮，忽略大小写并避免子串误匹配
- 支持跨可见分屏同步高亮，非脚本文件与后台标签不参与

### 上下文感知补全

- 按段过滤：`#IF` 段仅提示检测命令，`#ACT` 段仅提示执行命令，`#SAY` 段提示显示变量与 UI 组件
- 按字符触发：`<` → 系统变量与 UI 组件，`@` → 标签/触发器，`#` → 段标记，`!` → 取反检测命令；注释内不弹补全
- 按已输入前缀过滤排序，而非固定 A-Z 全量列表；已有闭合符（`>`、`(参数)>`、`[参数].B>`）自动吞并不重复插入
- `$STR(...)` 内支持类型变量和当前文档中文命名变量（如 `S$测试`）补全
- `SENDMSG` 智能补全：A 字段弹出编号列表（附用途说明），选择后自动 Tab 到 B 字段
- GameLoad.DB 物品/怪物/技能名首参补全：选中相关命令后自动弹出名称列表，手动输入中文等名称时也会自动触发并过滤

### 悬停文档

命令、检测命令、系统变量、UI 组件、类型变量（含超范围警告），均附官方文档链接。

### 跳转与导航

所有标签引用与文件引用均支持 **Ctrl+点击** 跳转：

- **标签跳转**：`GOTO @标签`、`#CALL [文件] @标签`、`/@xxx`、`link=@xx`（UI 组件内）、`QueryMsg`（自动识别引擎实际的 `[@标签1]` 后缀规则）；普通 `@标签` 优先查找当前文件，未命中时跨文件搜索工作区引擎脚本，多个同名定义可选择跳转目标
- **文件跳转**：`#CALL [\目录\文件.txt]`、`PosInlist` 等命令的文件路径参数 → QuestDiary 下对应文件；`<$cfg_名称(行_列)>` → `cfg_名称.csv` 对应单元格（行列含变量时仅打开文件）
- **反向查找**：在 `[@标签]` 上 Ctrl+点击或按 Shift+F12，可查看当前文件及跨文件调用（含 `#CALL`）；标签上方 CodeLens 显示当前文件调用数
- `[@标签]` 支持折叠整个标签段

### 颜色调整

`color=224`（0-255 颜色卡）、`#0xffffa500`、`ffa500`（十六进制）均有颜色标识，点击即可调出取色器直接修改。

### 已占用变量查询

侧边栏「996脚本」面板，全工作区扫描 TXT/CSV 中的 A/S/P/D/G/I/M/U/T/J/Z 变量、个人标记 `[n]`、CustomValue（CV0-99）、自定义变量（`VAR` 声明），按类型分组、读写统计、点击跳转到占用位置。首次扫描有进度提示（通知 + 面板进度条），保存/关闭文件后自动重扫；扫描忽略 `.` 开头的目录（如 `.history`/`.git` 缓存）。

### 可视化管理器（地图 / 刷怪 / NPC）

打开对应配置文件时编辑器右上角出现入口按钮，进入同风格的可视化界面（分栏可拖拽、GBK 读写、注释与无法识别的行原样保留、文件在编辑器有未保存改动时拒绝保存）：

- **地图管理器**（`MapInfo.txt` / `MiniMap.txt`）：地图搜索/增删、映射方式（普通 / 镜像·沿用原图小地图 / 镜像·独立）、约 80 个地图参数按分类开关勾选、带参参数内联填写、小地图对照表编辑、改名地图号自动同步 MiniMap 行
- **刷怪管理器**（`MonGen.txt`）：按地图/按怪物分组（可折叠）与快捷筛选、智能刷怪 `*` 前缀识别、23 列参数分组编辑、读取 MapInfo.txt 显示地图名、TAB/不规则空格一键自动对齐
- **NPC管理器**（`Merchant.txt`）：按地图分组与快捷筛选、15 列参数分组编辑（基本/外观/行为/封号）、「打开脚本」一键跳转 Market_def 下对应 NPC 脚本（兼容 `同读` 前缀的多种目录布局，不存在时可一键创建骨架文件）

### 爆率管理

侧边栏「996脚本」容器的「爆率管理」入口，或打开 MonItems 目录下的爆率文件后点编辑器右上角按钮进入（与源文件双向跳转）：

- 左侧按 MonItems 目录结构展示爆率文件树（可折叠、可搜索），自动读取 GBK 文件
- 中间编辑区列出每条爆率行：物品组（权重、`不受翻倍` 标记）、分数爆率、**换算后的百分比**、附加条件；`#CALL` 嵌套调用行单独标注；支持行内编辑/删除/新增
- 右侧**掉落模拟**：输入轮数即可模拟，显示总统计（次数/实际爆率/理论爆率/偏差）与每轮明细；支持**爆率翻倍倍率**与**附加条件开关**
- **物品爆率查询**：查询当前文件或全局 MonItems 中某物品的爆率行，点击结果跳转并高亮

### RandomStr 权重模拟

`RandomStr` 命令行上方出现「⚖ 模拟权重」CodeLens，点击打开模拟面板：列出每项权重与理论概率（概率条对比），输入轮数即可模拟并显示每项命中次数与实际概率；权重为变量时可手动填值参与计算。

### 断点调试 Beta（内置脚本模拟器）

引擎无远程调试接口，插件内置脚本解释器，通过 VSCode 原生调试界面调试：

- 打开脚本按 **F5** 启动，支持断点、单步（F10 / F11 / Shift+F11）、变量窗口（按类型分组）、Watch 求值、调用堆栈
- 真实模拟：`MOV` `INC` `DEC` `CALCVAR` `VAR` `SET` `CHANGECUSTOMVALUE` 等变量命令、`EQUAL` `LARGE` `SMALL` `CHECK` `CHECKVAR` 条件、`GOTO`、`#CALL` 跨文件、`LoopGoto`（含 `@标签_END` 约定与 STOP/BREAK 退出）、`FOR/ENDFOR`、`DelayCall/DelayGoto`（立即调用模拟）
- 字符串变量上 `INC` 为拼接（SendUi 拼 UI 字符串写法）
- 游戏状态取值（`CHECKITEM`、`<$LEVEL>` 等）执行到时弹窗现场输入，会话内缓存
- 条件检测结果逐条输出到调试控制台，分支走向一目了然
- `presetVars` 启动配置可预设变量值，用于进入依赖游戏状态的分支；`maxSteps` 防死循环（默认 10 万步）
- 副作用命令（`GIVE` `TAKE` 等）不模拟，控制台输出"已跳过"；`#SAY` 文本输出为 NPC 对话预览

---

## 文件识别与编码

以下路径 / 文件名的 `.txt` 自动识别为 996 脚本（默认 GBK 编码打开）：

- `QuestDiary`、`Market_def`、`Npc_def`、`MapQuest_def`、`Robot_def`、`Funtion_def` 目录下的所有 `.txt`
- `QFunction-*.txt`、`QManage*.txt`、`QWolShop-*.txt`、`RobotManage.txt`、`AutoRunRobot.txt`
- 其他 `.txt` 若内容包含 `[@标签]`、`#IF` 等脚本特征会自动识别；也可通过命令「996脚本: 将当前文件识别为996脚本」手动切换
- 检测到乱码（未按 GBK 打开）时会提示重新以 GBK 编码打开
- 所有需要遍历工作区文件的功能（变量扫描、爆率文件树、标签定位等）统一忽略 `.` 开头的文件与文件夹

## 安装

从 [Releases](https://github.com/Nordul/996m2_WolScript-for_vscode/releases) 页面下载最新 `m2script-tools-x.x.x.vsix`，然后：

```bash
code --install-extension m2script-tools-x.x.x.vsix
```

或在 VSCode 扩展面板 `...` → `Install from VSIX...` 选择下载的文件。

## 开发

```bash
npm install
npm run compile                  # 编译 (tsc)
npm run crawl                    # 重新爬取官方文档生成命令库
npm run selftest                 # 扫描器 + 语法 + 解释器自测
node scripts/completiontest.js   # 补全 / 跳转 / 折叠 / 颜色 / CodeLens mock 测试
node scripts/daptest.js          # 调试适配器 DAP 消息流模拟测试
node scripts/mongentest.js       # 刷怪配置解析 round-trip
node scripts/merchanttest.js     # NPC配置解析 round-trip
node scripts/droptest.js         # 爆率模型与模拟
node scripts/mapeditortest.js    # 地图配置解析 round-trip
```

打包：`npx vsce package`

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `syntaxes/m2script.tmLanguage.json` | TextMate 语法（由 `scripts/build-grammar.js` 生成，勿手改） |
| `src/data/*.json` | 爬取生成的命令 / 变量 / 组件库 |
| `src/providers/` | 补全、悬停、跳转、折叠、颜色、标签引用、RandomStr CodeLens |
| `src/scanner/` | 变量占用扫描（`scanCore.ts` 为纯逻辑，可独立自测） |
| `src/mapeditor/` | 地图 / 刷怪 / NPC / 爆率可视化管理器（模型与面板） |
| `src/debug/` | 调试器：脚本解析、解释器核心、DAP 适配器、调试配置 |
| `src/views/` | 侧边栏变量面板、爆率入口、RandomStr 模拟面板 |
| `example/` | 示例脚本 |

## 相关链接

- GitHub 仓库：https://github.com/Nordul/996m2_WolScript-for_vscode
- 版本发布：https://github.com/Nordul/996m2_WolScript-for_vscode/releases
- 官方文档：http://cshelp.996m2.com/web/#/17/1210

使用中遇到问题或有功能建议，欢迎到 [Issues](https://github.com/Nordul/996m2_WolScript-for_vscode/issues) 反馈。

## License

[GPL-3.0](LICENSE)
