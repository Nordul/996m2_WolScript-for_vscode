<div align="center">

<img src="resources/icon.png" width="120" alt="996传世脚本" />

# 996传世脚本 (996WolScript)

**996M2 传世引擎脚本语言的 VSCode 一站式开发插件**

语法高亮 · 智能补全 · 静态检查 · 断点调试 · 可视化管理

[![Release](https://img.shields.io/github/v/release/Nordul/996m2_WolScript-for_vscode?include_prereleases&style=flat-square)](https://github.com/Nordul/996m2_WolScript-for_vscode/releases)
[![VS Code](https://img.shields.io/badge/VS_Code-1.85%2B-2C2C32?style=flat-square&logo=visualstudiocode&logoColor=0098FF)](https://code.visualstudio.com/)
[![Downloads](https://img.shields.io/github/downloads/Nordul/996m2_WolScript-for_vscode/total?style=flat-square)](https://github.com/Nordul/996m2_WolScript-for_vscode/releases)
[![License](https://img.shields.io/github/license/Nordul/996m2_WolScript-for_vscode?style=flat-square)](./LICENSE)

**552** 执行命令 · **198** 检测命令 · **318** 系统变量 · **139** 触发器 · **23** UI 组件 · **21** PC 界面标签

命令数据全量爬取自 [996 传世引擎官方文档](http://cshelp.996m2.com/web/#/17/1210)，随文档持续同步。

</div>

---

## ✨ 功能特性

| 功能 | 说明 |
| --- | --- |
| [语法高亮](#语法高亮) | 段标记、命令、变量、UI 组件、系统变量嵌套表达式全面着色 |
| [相同词高亮](#相同词高亮) | 光标所在词当前文件整词高亮，跨可见分屏同步 |
| [上下文感知补全](#上下文感知补全) | 按段 / 按触发字符智能过滤，前缀匹配排序，闭合符自动吞并 |
| [悬停文档](#悬停文档) | 命令、变量、组件即查即看，附官方文档链接 |
| [静态检查](#静态检查) | IF/ACT 命令错位、括号配对、全角标点实时诊断 |
| [跳转与导航](#跳转与导航) | 标签 / 文件 / CSV 单元格跳转，反向查找引用，标签折叠 |
| [断点调试 (Beta)](#断点调试beta) | 内置脚本解释器，VSCode 原生调试界面，F5 即用 |
| [颜色调整](#颜色调整) | 颜色代码标识与取色器，侧边栏 256 色调色板 |
| [已占用变量查询](#已占用变量查询) | 全工作区扫描变量占用，分组统计、点击跳转 |
| [RandomStr 权重模拟](#randomstr-权重模拟) | 行内 CodeLens 一键模拟权重概率 |
| [可视化管理器](#可视化管理器地图刷怪npc) | 地图 / 刷怪 / NPC 配置表格化管理 |
| [爆率管理](#爆率管理) | 爆率文件树、行内编辑、掉落模拟、物品爆率查询 |

### 语法高亮

- 段标记 `#IF` `#IFONE` `#ACT` `#SAY` `#ELSEACT` `#ELSESAY`、标签 `[@xxx]`、跳转 `/@xxx`
- 执行/检测命令（含 `!` 前缀取反）、类型变量（`S0` `A12` `D5`…）、命名变量（`N$羽翼升级`）、个人标记 `[8]`
- 系统变量 `<$USERNAME>`、取值语法 `<$STR(S0)>`、嵌套表达式 `<$DEC^<$STR(N$x)>^10>`
- UI 组件 `<Text|…>` `<Button|…>`，组件名 / 参数名 / 参数值独立着色
- PC 旧式界面 `<Color=…>`、`<offx=|…>`、`<@@!XYBTN …>` 等 21 种标签及参数高亮，兼容 `<@!XYBTN …>` 写法

### 相同词高亮

- 光标所在词在当前文件内整词高亮，忽略大小写并避免子串误匹配
- 支持跨可见分屏同步高亮，非脚本文件与后台标签不参与

### 上下文感知补全

- 按段过滤：`#IF` 段仅提示检测命令，`#ACT` 段仅提示执行命令，`#SAY` 段提示显示变量与 UI 组件
- 按字符触发：`<` → 系统变量与 UI 组件，`@` → 标签/触发器，`#` → 段标记，`!` → 取反检测命令；注释内不弹补全
- 按已输入前缀过滤排序，而非固定 A-Z 全量列表；已有闭合符（`>`、`(参数)>`、`[参数].B>`）自动吞并不重复插入
- `$STR(...)` 内支持类型变量和当前文档中文命名变量（如 `S$测试`）补全
- `SENDMSG` 智能补全：A 字段弹出编号列表（附用途说明），选择后自动 Tab 到 B 字段

### 悬停文档

命令、检测命令、系统变量、UI 组件、类型变量（含超范围警告），均附官方文档链接。支持 `<$cfg_名称(行_列)>`、`Getcsv`、`GetTypeBRow`、`GetTypeERow` 及 `NEWREADCSV`、`NEWDQCSV`、`GETHLCSV`、`GETGJCSV` 等 CSV 宏与命令说明。

### 静态检查

- 实时检查 `#IF/#IFONE` 段中的执行命令（含 `#CALL`）、`#ACT/#ELSEACT` 段中的检测命令，以及不在任何有效段或写在 `#SAY/#ELSESAY` 中的已知命令，并在「问题」面板显示错误位置与修复提示；段外直接调用 `#CALL`（包括 QFunction 文件顶部）是合法例外
- 已知系统变量表达式单独占一行时警告，提示作为命令参数使用；命令参数和 `#SAY` 显示不受影响
- 按行检查 `()`、`[]` 是否缺失、错配或多余；`{}` 支持标签内容的跨行包裹
- 检查常见全角标点及全角空格；`#SAY/#ELSESAY` 对话文本和注释不检查，编辑时自动刷新诊断。可在设置中通过 `996脚本 › Diagnostics: Fullwidth Punctuation` 关闭，默认开启

### 跳转与导航

所有标签引用与文件引用均支持 **Ctrl+点击** 跳转：

- **标签跳转**：`GOTO @标签`、`#CALL [文件] @标签`、`/@xxx`、`link=@xx`（UI 组件内）、`QueryMsg`（自动识别引擎实际的 `[@标签1]` 后缀规则）；普通 `@标签` 优先查找当前文件，未命中时跨文件搜索工作区引擎脚本，多个同名定义可选择跳转目标
- **文件跳转**：`#CALL [\目录\文件.txt]`、`PosInlist` 等命令的文件路径参数 → QuestDiary 下对应文件；`<$cfg_名称(行_列)>` → `cfg_名称.csv` 对应单元格（行列含变量时仅打开文件）
- **反向查找**：在 `[@标签]` 上 Ctrl+点击或按 Shift+F12，可查看当前文件及跨文件调用（含 `#CALL`）；标签上方 CodeLens 显示当前文件调用数
- **当前文件标签**：点击活动栏独立的「标签导航」按钮，按文件顺序展示全部 `[@xx]` 与行号，单击或回车即可选中并居中跳转；顶部搜索框支持忽略大小写、省略 `@` 和空格组合关键词，实时显示匹配数/总数，支持清除按钮与 Esc 清空；切换文件和编辑时自动刷新，支持本地与 SSH 远程文件
- `[@标签]` 支持折叠整个标签段

### 断点调试（Beta）

引擎无远程调试接口，插件内置脚本解释器，通过 VSCode 原生调试界面调试：

- 打开脚本按 **F5** 启动，支持断点、单步（F10 / F11 / Shift+F11）、变量窗口（按类型分组）、Watch 求值、调用堆栈
- 真实模拟：`MOV` `INC` `DEC` `CALCVAR` `VAR` `SET` `CHANGECUSTOMVALUE` 等变量命令、`EQUAL` `LARGE` `SMALL` `CHECK` `CHECKVAR` 条件、`GOTO`、`#CALL` 跨文件、`LoopGoto`（含 `@标签_END` 约定与 STOP/BREAK 退出）、`FOR/ENDFOR`、`DelayCall/DelayGoto`（立即调用模拟）
- 字符串变量上 `INC` 为拼接（SendUi 拼 UI 字符串写法）
- 游戏状态取值（`CHECKITEM`、`<$LEVEL>` 等）执行到时弹窗现场输入，会话内缓存
- 条件检测结果逐条输出到调试控制台，分支走向一目了然
- `presetVars` 启动配置可预设变量值，用于进入依赖游戏状态的分支；`maxSteps` 防死循环（默认 10 万步）
- 副作用命令（`GIVE` `TAKE` 等）不模拟，控制台输出「已跳过」；`#SAY` 文本输出为 NPC 对话预览

### 颜色调整

`color=224`（0-255 颜色卡）、`#0xffffa500`、`ffa500`（十六进制）均有颜色标识，点击即可调出取色器直接修改。在颜色代码上 Ctrl+点击可直接展开侧边栏「颜色选择」。侧边栏提供 256 色调色板，可切换 `color=编号` 或 `#0x十六进制` 输出，并在编辑器光标处插入或替换 `color=编号`、`color=RRGGBB`、`#0x` 颜色代码；显示当前代码的真实预览色，替换 `color=RRGGBB` 时保留原格式。

### 已占用变量查询

侧边栏「996脚本」面板，全工作区扫描 TXT/CSV 中的 A/S/P/D/G/I/M/U/T/J/Z 变量、个人标记 `[n]`、CustomValue（CV0-99）、自定义变量（`VAR` 声明），按类型分组、读写统计、点击跳转到占用位置。启动时先恢复上次缓存并后台校验，未变化文件无需重新读取；保存、未保存编辑、关闭文档及外部新增/修改/删除均按单文件更新索引。本地扫描最多 8 并发、SSH 最多 4 并发；手动刷新可强制全量重建。扫描忽略 `.` 开头的目录（如 `.history`/`.git` 缓存）。

### RandomStr 权重模拟

`RandomStr` 命令行上方出现「⚖ 模拟权重」CodeLens，点击打开模拟面板：列出每项权重与理论概率（概率条对比），输入轮数即可模拟并显示每项命中次数与实际概率；权重为变量时可手动填值参与计算。

### 可视化管理器（地图/刷怪/NPC）

打开对应配置文件时编辑器右上角出现入口按钮，进入同风格的可视化界面（分栏可拖拽、GBK 读写、注释与无法识别的行原样保留、文件在编辑器有未保存改动时拒绝保存）：

- **地图管理器**（`MapInfo.txt` / `MiniMap.txt`）：地图搜索/增删、映射方式（普通 / 镜像·沿用原图小地图 / 镜像·独立）、约 80 个地图参数按分类开关勾选、带参参数内联填写、小地图对照表编辑、改名地图号自动同步 MiniMap 行
- **刷怪管理器**（`MonGen.txt`）：按地图/按怪物分组（可折叠）与快捷筛选、智能刷怪 `*` 前缀识别、23 列参数分组编辑、读取 MapInfo.txt 显示地图名、TAB/不规则空格一键自动对齐
- **NPC 管理器**（`Merchant.txt`）：按地图分组与快捷筛选、15 列参数分组编辑（基本/外观/行为/封号）、「打开脚本」一键跳转 Market_def 下对应 NPC 脚本（兼容 `同读` 前缀的多种目录布局，不存在时可一键创建骨架文件）

### 爆率管理

侧边栏「996脚本」容器的「爆率管理」入口，或打开 MonItems 目录下的爆率文件后点编辑器右上角按钮进入（与源文件双向跳转）：

- 左侧按 MonItems 目录结构展示爆率文件树（可折叠、可搜索），自动读取 GBK 文件
- 中间编辑区列出每条爆率行：物品组（权重、`不受翻倍` 标记）、分数爆率、**换算后的百分比**、附加条件；`#CALL` 嵌套调用行单独标注；支持行内编辑/删除/新增
- 右侧**掉落模拟**：输入轮数即可模拟，显示总统计（次数/实际爆率/理论爆率/偏差）与每轮明细；支持**爆率翻倍倍率**与**附加条件开关**
- **物品爆率查询**：查询当前文件或全局 MonItems 中某物品的爆率行，点击结果跳转并高亮

---

## 📦 安装

从 [Releases](https://github.com/Nordul/996m2_WolScript-for_vscode/releases) 下载最新的 `m2script-tools-x.x.x.vsix`：

```bash
code --install-extension m2script-tools-x.x.x.vsix --force
```

或在 VSCode 扩展面板 `⋯` → **Install from VSIX...** 选择下载的文件。

也可源码构建：

```bash
git clone https://github.com/Nordul/996m2_WolScript-for_vscode.git
cd 996m2_WolScript-for_vscode
npm install
npx vsce package
code --install-extension m2script-tools-*.vsix --force
```

> **提示**：重装**同版本号**的 vsix 后需完全关闭并重启 VSCode 才会生效，建议始终安装递增版本。

## 🚀 快速上手

安装后用 VSCode 打开服务端资源根目录（含 `QuestDiary`、`Market_def` 等目录）即可，无需任何配置：

1. **打开脚本**：脚本目录下的 `.txt` 自动识别为 996 脚本并以 GBK 编码打开
2. **编写代码**：`#` `@` `<` `!` 触发智能补全，悬停查看命令文档，「问题」面板实时显示静态检查结果
3. **断点调试**：在脚本中打断点，按 **F5** 启动内置调试器，单步跟踪变量与分支走向
4. **可视化管理**：打开 `MapInfo.txt` / `MonGen.txt` / `Merchant.txt` / MonItems 爆率文件时，编辑器右上角出现对应管理器入口
5. **辅助面板**：活动栏独立的「标签导航」按钮用于当前文件标签跳转；「996脚本」容器提供已占用变量查询、爆率管理、颜色选择三个面板

## 📂 文件识别与编码

以下路径 / 文件名的 `.txt` 自动识别为 996 脚本（默认 GBK 编码打开）：

- `QuestDiary`、`Market_def`、`Npc_def`、`MapQuest_def`、`Robot_def`、`Funtion_def` 目录下的所有 `.txt`
- `QFunction-*.txt`、`QManage*.txt`、`QWolShop-*.txt`、`RobotManage.txt`、`AutoRunRobot.txt`
- 其他 `.txt` 若内容包含 `[@标签]`、`#IF` 等脚本特征会自动识别；也可通过命令「996脚本: 将当前文件识别为996脚本」手动切换
- 检测到乱码（未按 GBK 打开）时会提示重新以 GBK 编码打开
- 所有需要遍历工作区文件的功能（变量扫描、爆率文件树、标签定位等）统一忽略 `.` 开头的文件与文件夹

## ❓ 常见问题

<details>
<summary><b>打开脚本文件显示乱码？</b></summary>

996 引擎脚本为 GBK 编码。插件默认按 GBK 打开已识别的脚本文件；若检测到乱码会提示重新以 GBK 编码打开，也可通过右下角状态栏编码按钮 →「Reopen with Encoding」→ `GBK` 手动切换。
</details>

<details>
<summary><b>我的 .txt 没有被识别为 996 脚本？</b></summary>

见上文「文件识别与编码」；临时方案：命令面板（Ctrl+Shift+P）执行「996脚本: 将当前文件识别为996脚本」。
</details>

<details>
<summary><b>重新安装 / 更新后新功能没有生效？</b></summary>

VSCode 对同版本号扩展有缓存，重装同版本 vsix 后需<b>完全关闭所有 VSCode 窗口再重新打开</b>。建议安装时始终使用递增的版本号。
</details>

<details>
<summary><b>断点调试和真实引擎有差异吗？</b></summary>

插件内置脚本解释器进行本地模拟：变量运算、条件判断、流程跳转（GOTO / #CALL / 循环）均真实执行；依赖游戏状态的取值（如 CHECKITEM、&lt;$LEVEL&gt;）执行到时会弹窗现场输入并在会话内缓存；副作用命令（GIVE、TAKE 等）仅记录跳过，不影响流程。
</details>

---

## 🛠️ 开发

```bash
npm install         # 安装依赖
npm run compile     # 编译（tsc）
npm run watch       # 监听编译
npm run crawl       # 重新爬取官方文档，生成命令库与语法文件
```

测试套件（均为 mock VSCode API 的 Node 脚本，改动后必跑）：

```bash
npm run selftest                    # 扫描器 + 语法 + 解释器 + 高亮 + 诊断
node scripts/completiontest.js      # 补全 / 跳转 / 折叠 / 颜色 / CodeLens
node scripts/daptest.js             # 调试适配器 DAP 消息流
node scripts/mapeditortest.js       # 地图配置解析 round-trip
node scripts/mongentest.js          # 刷怪配置解析 round-trip
node scripts/merchanttest.js        # NPC 配置解析 round-trip
node scripts/droptest.js            # 爆率模型与模拟
node scripts/scantest.js            # 扫描核心
```

打包：`npx vsce package`

### 目录结构

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

## 🤝 参与贡献

- 发现 Bug 或有功能建议？欢迎提 [Issue](https://github.com/Nordul/996m2_WolScript-for_vscode/issues)
- 提交 PR 前请确保上述测试套件全部通过

## 📄 License

本项目采用 [GPL-3.0](./LICENSE) 协议开源。

<p align="center">
  <sub>996WolScript · 由 <a href="https://github.com/Nordul">@Nordul</a> 维护 · 命令数据来自 <a href="http://cshelp.996m2.com/web/#/17/1210">996 传世引擎官方文档</a></sub>
</p>
