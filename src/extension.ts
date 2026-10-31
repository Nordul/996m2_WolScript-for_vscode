import * as vscode from 'vscode';
import { M2CompletionProvider, parseDbNameFirstArg } from './providers/completion';
import { M2HoverProvider } from './providers/hover';
import { M2DefinitionProvider } from './providers/definition';
import { M2FoldingProvider } from './providers/folding';
import { M2ColorProvider } from './providers/color';
import { M2ReferenceProvider, M2LabelCodeLensProvider } from './providers/references';
import { RandomStrCodeLensProvider } from './providers/randomStrLens';
import { RandomStrPanel } from './views/randomStrPanel';
import { VarScanner, isEngineScriptPath } from './scanner/varScanner';
import { VarPanelProvider } from './views/varPanel';
import { M2DebugConfigProvider, M2DebugAdapterFactory } from './debug/configProvider';
import { MapManagerPanel, isMapConfigFile, isMonGenFile, isMonItemFile, isMerchantFile } from './mapeditor/mapManagerPanel';
import { MonGenPanel } from './mapeditor/monGenPanel';
import { MerchantPanel } from './mapeditor/merchantPanel';
import { DropPanel } from './mapeditor/dropPanel';
import { DropEntryProvider } from './views/dropEntry';
import { DbViewerPanel } from './views/dbViewerPanel';
import { DbEntryProvider } from './views/dbEntry';

/** 内容嗅探: 普通 txt 若含 996 脚本特征则切换语言 */
const SCRIPT_FEATURE_RE = /^\s*(\[@[^\]]+\]|#(IF|ACT|SAY|ELSEACT|ELSESAY)\b)/im;

/** 编码嗅探: 文本含 U+FFFD 说明 GBK 文件被按 UTF-8 解码了 */
function looksMisdecoded(doc: vscode.TextDocument): boolean {
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 100), 0));
  return head.includes('');
}

let encodingPromptShown = false;

/** 检测到乱码时引导用户以 GBK 重新打开 (每会话最多提醒一次, auto 时直接弹编码选择) */
async function promptReopenAsGbk(doc: vscode.TextDocument, auto: boolean) {
  if (doc.isDirty || doc.uri.scheme !== 'file') return;
  if (!looksMisdecoded(doc)) return;
  if (!auto) {
    if (encodingPromptShown) return;
    encodingPromptShown = true;
    const pick = await vscode.window.showWarningMessage(
      '检测到 996 脚本可能未以 GBK 编码打开（出现乱码）',
      '以 GBK 重新打开',
    );
    if (!pick) return;
  }
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.files.reopenWithEncoding');
}

async function sniffDocument(doc: vscode.TextDocument) {
  if (doc.languageId !== 'plaintext' && doc.languageId !== 'm2script') return;
  if (doc.languageId === 'm2script') return;
  if (!doc.fileName.toLowerCase().endsWith('.txt')) return;
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 200), 0));
  if (SCRIPT_FEATURE_RE.test(head)) {
    await vscode.languages.setTextDocumentLanguage(doc, 'm2script');
    await promptReopenAsGbk(doc, false);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const scanner = new VarScanner();
  const panel = new VarPanelProvider(scanner);
  let skipNextDbSelection = false;

  const selector: vscode.DocumentSelector = { language: 'm2script', scheme: 'file' };
  // 字母也作为触发字符: 即使用户关闭了 quickSuggestions, 输入命令字母也能弹出补全
  const letterTriggers = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new M2CompletionProvider(context), '<', '$', '@', '#', '!', '(', '|', ' ', ...letterTriggers),
    vscode.languages.registerHoverProvider(selector, new M2HoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new M2DefinitionProvider()),
    vscode.languages.registerReferenceProvider(selector, new M2ReferenceProvider()),
    vscode.languages.registerCodeLensProvider(selector, new M2LabelCodeLensProvider()),
    vscode.languages.registerCodeLensProvider(selector, new RandomStrCodeLensProvider()),
    vscode.languages.registerFoldingRangeProvider(selector, new M2FoldingProvider()),
    vscode.languages.registerColorProvider(selector, new M2ColorProvider()),
    vscode.window.registerWebviewViewProvider('m2script.varPanel', panel),
    vscode.window.registerWebviewViewProvider('m2script.dropEntry', new DropEntryProvider()),
    vscode.window.registerWebviewViewProvider('m2script.dbEntry', new DbEntryProvider()),
    vscode.debug.registerDebugConfigurationProvider('m2script', new M2DebugConfigProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('m2script', new M2DebugAdapterFactory()),
    vscode.commands.registerCommand('m2script.refreshVars', () => panel.refresh()),
    vscode.commands.registerCommand('m2script.triggerDbSuggest', () => {
      setTimeout(() => {
        skipNextDbSelection = true;
        void vscode.commands.executeCommand('editor.action.triggerSuggest');
      }, 50);
    }),
    vscode.commands.registerCommand('m2script.simRandomStr', (listRaw: string) => RandomStrPanel.show(context, listRaw)),
    vscode.commands.registerCommand('m2script.openMapManager', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file' || !isMapConfigFile(editor.document.uri.fsPath)) {
        void vscode.window.showInformationMessage('请先打开 MapInfo.txt、MiniMap.txt 或 MonGen.txt 文件');
        return;
      }
      const uri = editor.document.uri;
      if (isMonGenFile(uri.fsPath)) MonGenPanel.show(context, uri);
      else MapManagerPanel.show(context, uri);
    }),
    vscode.commands.registerCommand('m2script.openDropManager', () => {
      const editor = vscode.window.activeTextEditor;
      const fsPath = editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
      DropPanel.show(context, fsPath && isMonItemFile(fsPath) ? fsPath : undefined);
    }),
    vscode.commands.registerCommand('m2script.openDbViewer', () => DbViewerPanel.show(context)),
    vscode.commands.registerCommand('m2script.openMerchantManager', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file' || !isMerchantFile(editor.document.uri.fsPath)) {
        void vscode.window.showInformationMessage('请先打开 Merchant.txt 文件');
        return;
      }
      MerchantPanel.show(context, editor.document.uri);
    }),
    vscode.commands.registerCommand('m2script.markAsScript', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await vscode.languages.setTextDocumentLanguage(editor.document, 'm2script');
        await promptReopenAsGbk(editor.document, true);
      }
    }),
  );

  // 内容嗅探: 已打开 + 新打开的 txt
  for (const doc of vscode.workspace.textDocuments) void sniffDocument(doc);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => void sniffDocument(doc)),
  );

  // 命令片段占位符及手动输入的数据库名称均主动唤醒建议(含中文/数字/符号)
  let dbNameSuggestTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    { dispose: () => { if (dbNameSuggestTimer) clearTimeout(dbNameSuggestTimer); } },
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const editor = e.textEditor;
      const doc = editor.document;
      if (doc.languageId !== 'm2script' || doc.uri.scheme !== 'file') return;
      if (skipNextDbSelection) {
        skipNextDbSelection = false;
        return;
      }
      if (dbNameSuggestTimer) clearTimeout(dbNameSuggestTimer);
      dbNameSuggestTimer = setTimeout(() => {
        dbNameSuggestTimer = undefined;
        if (vscode.window.activeTextEditor !== editor) return;
        const position = editor.selection.end;
        const before = doc.lineAt(position.line).text.slice(0, position.character);
        if (!parseDbNameFirstArg(before)) return;
        void vscode.commands.executeCommand('m2script.triggerDbSuggest');
      }, 50);
    }),
  );

  // 地图配置文件: 激活编辑器是 MapInfo.txt / MiniMap.txt 时显示「地图管理」按钮
  const updateMapFileContext = () => {
    const editor = vscode.window.activeTextEditor;
    const fsPath = editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    void vscode.commands.executeCommand('setContext', 'm2script.mapFile', !!fsPath && isMapConfigFile(fsPath));
    void vscode.commands.executeCommand('setContext', 'm2script.monItemFile', !!fsPath && isMonItemFile(fsPath));
    void vscode.commands.executeCommand('setContext', 'm2script.merchantFile', !!fsPath && isMerchantFile(fsPath));
  };
  updateMapFileContext();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateMapFileContext),
  );

  // 变量扫描: 激活时全量一次(首次带进度提示), 之后保存/关闭时防抖重扫
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'M2Script: 首次扫描已占用变量', cancellable: false },
    (progress) => {
      let prev = 0;
      const disp = scanner.onDidProgress((p) => {
        if (!p || !p.total) return;
        const pct = p.done / p.total * 100;
        progress.report({ message: p.done + '/' + p.total + ' 个文件', increment: pct - prev });
        prev = pct;
      });
      return scanner.scanWorkspace().catch((e) => {
        console.error('[M2Script] 首次变量扫描失败:', e);
      }).finally(() => disp.dispose());
    },
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'm2script' || isEngineScriptPath(doc.uri.fsPath)) scanner.scheduleScan();
    }),
    vscode.workspace.onDidCloseTextDocument(() => scanner.scheduleScan(1500)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scanner.scheduleScan(100)),
  );
}

export function deactivate() {}

