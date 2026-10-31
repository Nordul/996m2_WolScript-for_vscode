# 项目记忆（供 AI 模型阅读）

> 本文件是这个项目的持久记忆，新会话的 AI 请先读完本文件再动手。
> 最后更新：2026-11（v0.2.18 Beta）

## 项目是什么

**m2script-tools**：996M2 传世引擎脚本语言（WolScript）的 VSCode 插件，TypeScript 编写。

- GitHub：https://github.com/Nordul/996m2_WolScript-for_vscode （Public，账号 Nordul）
- 本地路径：`D:\vibe_c\vscode_new`
- 当前版本：**0.2.18**（dev 分支，Beta 预发布）；main 分支停留在 **0.1.10**（Latest 正式版）
- 分支策略：功能开发在 **dev** 分支，稳定后合并 main 再发正式 Release

## 重要资料

- 996 引擎说明书（脚本命令大全）：http://cshelp.996m2.com/web/#/17/962
- 文档首页：http://cshelp.996m2.com/web/#/17/1210
- 文档站为 ShowDoc，取页面内容 API：`POST http://cshelp.996m2.com/server/index.php?s=/api/page/info`，body `page_id=<id>`（URL `#/17/<id>` 的 id 即 page_id）；页面目录在 `docs_raw/menu.json`（含 page_id ↔ 标题映射）
- 命令库数据 `src/data/*.json` 由 `scripts/crawl-docs.js` 爬取生成；**重跑后必须与 git HEAD 旧数据做并集合并**（约 31 条手工补录不在爬取范围，直接覆盖会丢）

## 已实现功能（代码位置）

| 功能 | 位置 |
| --- | --- |
| 语法高亮 | `syntaxes/m2script.tmLanguage.json`（**由 `scripts/build-grammar.js` 生成，改高亮改生成器再跑 `node scripts/build-grammar.js`，勿手改**） |
| 上下文补全 | `src/providers/completion.ts`（按段过滤、前缀过滤、闭合符吞并、SENDMSG 编号、GameLoad.DB 物品/怪物/技能名首参补全、STR 内中文命名变量；触发字符含空格，选中 DB 命令及手动输入名称均自动触发） |
| 悬停文档 | `src/providers/hover.ts` |
| 跳转导航 | `src/providers/definition.ts`（GOTO/link=/@xx/QueryMsg→[@标签1]，普通 @标签当前文件优先、跨文件兜底；#CALL/PosInlist 路径/cfg_名称(行_列)→CSV） |
| 标签反向引用 | `src/providers/references.ts`（CodeLens 当前文件「N 处调用」；Ctrl+点击定义/Shift+F12 跨文件查找调用，含 #CALL） |
| 标签折叠 | `src/providers/folding.ts` |
| 颜色调整 | `src/providers/color.ts`（0-255 调色板 / #0xAARRGGBB / RRGGBB；调色板颜色卡只出 256 项编号） |
| RandomStr 权重模拟 | `src/providers/randomStrLens.ts` + `src/views/randomStrPanel.ts` |
| 变量占用查询 | `src/scanner/varScanner.ts` + `scanCore.ts`（纯逻辑，扫描 TXT/CSV）+ `src/views/varPanel.ts`（进度提示、防抖重扫） |
| 断点调试 | `src/debug/`（内置脚本解释器 + DAP 适配器，F5 启动） |
| 地图管理器 | `src/mapeditor/mapModel.ts` + `mapManagerPanel.ts`（MapInfo/MiniMap） |
| 刷怪管理器 | `src/mapeditor/monGenModel.ts` + `monGenPanel.ts`（MonGen.txt，23 列，智能刷怪 `*` 前缀） |
| NPC 管理器 | `src/mapeditor/merchantModel.ts` + `merchantPanel.ts`（Merchant.txt，15 列，「打开脚本」跳 Market_def，`同读` 前缀多布局候选 + 递归搜索） |
| 爆率管理 | `src/mapeditor/dropModel.ts` + `dropPanel.ts` + 入口 `src/views/dropEntry.ts`（MonItems，编辑+模拟+物品查询） |
| GameLoad.DB | `src/db/gameLoadDb.ts`（加载/定位）+ `dbQueries.ts`（纯查询）+ `src/views/dbViewerPanel.ts` + 入口 `src/views/dbEntry.ts` |

可视化管理器共同约定：webview 单例面板、`makeResizable` 可拖拽分栏（宽度 `vscode.setState` 持久化）、GBK 读写、注释/空行/坏行 round-trip 原样保留、行内 `;` 是空列占位符（显示为空、保存时中间空列写回 `;`）、保存时文件在编辑器 dirty 则拒绝、打开时检测 Tab/多空格提示自动对齐。

## 环境与技术要点（踩过的坑）

- **脚本/配置文件全部 GBK**：读用 `scanCore.ts` 的 `decodeScript`，写用 `iconv-lite`（已加入 dependencies）
- **vsix 打包必须带依赖**，不要加 `--no-dependencies`；`.vscodeignore` 排除 `node_modules/**` 后按文件白名单放行（注意：**npm 包必须连它的 `package.json` 一起放行**，否则 require 解析失败——sql.js 曾因此导致插件无法激活）
- **sql.js 懒加载**（`await import`），即使模块缺失也只影响 DB 功能不拖崩插件
- **GameLoad.DB 是 SQLite 3，文本列是 GBK 字节**：必须 `CAST(col AS BLOB)` 取原始字节再 iconv-lite 解码；**过滤不能用 LIKE**（GBK 字节会被按 UTF-8 码点误读），用 `instr(CAST(col AS BLOB), X'...') > 0`
- **glob 不允许嵌套花括号**（`{**/{a,b}/**}` 会报错 code 2），排除模式必须平铺
- 遍历工作区文件统一用 `scanCore.ts` 的 `IGNORE_GLOB` + `hasHiddenSegment`（忽略 `.` 开头文件/文件夹，防 `.history` 缓存干扰）
- GameLoad.DB 定位：先 `findFiles('**/GameLoad.DB')`，找不到再从当前脚本文件向上找 `DB\GameLoad.DB`（工作区根可能是 Envir 子目录）；加载失败不缓存，后续调用自动重试，避免首次缺失后补全永久失效
- 扩展宿主 Node 版本不保证有 `node:sqlite`，所以用 sql.js（WASM）；测试脚本在系统 Node（v24）里可以用 `node:sqlite`

## 开发工作流

- 编译：`npx tsc`
- 验证套件（改动后必跑）：`node scripts/grammartest.js && node scripts/selftest.js && node scripts/completiontest.js && node scripts/interpretertest.js`，另有 `mapeditortest / mongentest / droptest / merchanttest / dbtest / scantest / daptest`（均为 mock vscode API 的 Node 脚本；改 activate 相关代码后注意 `completiontest.js` 的 mock 可能需要补 API）
- 打包安装：`rm -f m2script-tools-*.vsix && npx vsce package && code --install-extension m2script-tools-<版本>.vsix --force`
- **同版本号重装必须完全关闭重开 VSCode 才生效**（老坑）；迭代功能时优先 bump 版本号避免混淆
- 发布流程：`npm version <x.y.z> --no-git-tag-version` → 打包安装 → `git add` 显式文件 → commit → push → `git tag v<x.y.z>` → push tag → `gh release create`

## Git / 发布约定

- **`dap_demo.txt` 永不提交**（本地调试产物）；commit 一律用显式 `git add` 指定文件，不用 `git add -A`
- git 推送需代理，仓库已配 `git config http.proxy http://127.0.0.1:7890`
- gh CLI 在 `C:\Program Files\GitHub CLI\gh.exe`（PATH 未刷新，用全路径）
- Release 惯例：vsix 作为附件上传，notes 按「新功能 / 修复与优化」分节

## 用户偏好

- 沟通用中文；UI 风格「简约现代」，复用 VSCode CSS 变量
- 功能入口喜欢放在：编辑器右上角按钮（配置文件类）/ 侧边栏「996脚本」容器（面板类）/ CodeLens（行级操作）
- 不确定的需求先提问；开发中模糊问题按最合理理解实现
- 每次功能更新并验证通过后，默认打包安装到 VSCode 方便用户测试；迭代时优先 bump 版本号，避免同版本缓存
