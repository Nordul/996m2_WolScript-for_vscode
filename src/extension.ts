import * as vscode from 'vscode';
import { M2CompletionProvider } from './providers/completion';
import { M2HoverProvider } from './providers/hover';
import { M2DefinitionProvider } from './providers/definition';
import { M2FoldingProvider } from './providers/folding';
import { M2ColorProvider, M2ColorDefinitionProvider, consumeColorNavigation } from './providers/color';
import { M2ReferenceProvider, M2LabelCodeLensProvider } from './providers/references';
import { M2DocumentHighlightProvider, M2CrossFileHighlighter } from './providers/highlight';
import { M2Diagnostics } from './providers/diagnostics';
import { RandomStrCodeLensProvider } from './providers/randomStrLens';
import { RandomStrPanel } from './views/randomStrPanel';
import { VarScanner } from './scanner/varScanner';
import { VarPanelProvider } from './views/varPanel';
import { M2DebugConfigProvider, M2DebugAdapterFactory } from './debug/configProvider';
import { MapManagerPanel, isMapConfigFile, isMonGenFile, isMonItemFile, isMerchantFile } from './mapeditor/mapManagerPanel';
import { MonGenPanel } from './mapeditor/monGenPanel';
import { MerchantPanel } from './mapeditor/merchantPanel';
import { DropPanel } from './mapeditor/dropPanel';
import { DropEntryProvider } from './views/dropEntry';
import { ColorPickerProvider } from './views/colorPickerPanel';
import { LabelNavigatorProvider, LabelSearchProvider, goToLabel } from './views/labelNavigator';

/** 内容嗅探: 普通 txt 若含 996 脚本特征则切换语言 */
const SCRIPT_FEATURE_RE = /^\s*(\[@[^\]]+\]|#(IF|ACT|SAY|ELSEACT|ELSESAY)\b)/im;

/** 编码嗅探: 文本含 U+FFFD 说明 GBK 文件被按 UTF-8 解码了 */
function looksMisdecoded(doc: vscode.TextDocument): boolean {
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 100), 0));
  return head.includes('');
}

let encodingPromptShown = false;
let activeScanner: VarScanner | undefined;

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
  activeScanner = new VarScanner(context);
  const scanner = activeScanner;
  context.subscriptions.push(scanner);
  const panel = new VarPanelProvider(scanner);
  const diagnostics = new M2Diagnostics();
  const labelNavigator = new LabelNavigatorProvider();
  const labelView = vscode.window.createTreeView('m2script.labelNavigator', { treeDataProvider: labelNavigator });
  labelNavigator.attachView(labelView);
  context.subscriptions.push(
    diagnostics,
    labelNavigator,
    labelView,
    vscode.window.registerWebviewViewProvider('m2script.labelSearch', new LabelSearchProvider(labelNavigator)),
    vscode.commands.registerCommand('m2script.refreshLabels', () => labelNavigator.refresh()),
    vscode.commands.registerCommand('m2script.goToLabel', goToLabel),
  );

  const selector: vscode.DocumentSelector = [
    { language: 'm2script', scheme: 'file' },
    { language: 'm2script', scheme: 'vscode-remote' },
  ];
  // 字母也作为触发字符: 即使用户关闭了 quickSuggestions, 输入命令字母也能弹出补全
  const letterTriggers = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new M2CompletionProvider(context), '<', '$', '@', '#', '!', '(', '|', ' ', ...letterTriggers),
    vscode.languages.registerHoverProvider(selector, new M2HoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new M2DefinitionProvider()),
    vscode.languages.registerReferenceProvider(selector, new M2ReferenceProvider()),
    vscode.languages.registerDocumentHighlightProvider(selector, new M2DocumentHighlightProvider()),
    vscode.languages.registerCodeLensProvider(selector, new M2LabelCodeLensProvider()),
    vscode.languages.registerCodeLensProvider(selector, new RandomStrCodeLensProvider()),
    vscode.languages.registerFoldingRangeProvider(selector, new M2FoldingProvider()),
    vscode.languages.registerColorProvider(selector, new M2ColorProvider()),
    vscode.languages.registerDefinitionProvider(selector, new M2ColorDefinitionProvider()),
    vscode.window.registerWebviewViewProvider('m2script.varPanel', panel),
    vscode.window.registerWebviewViewProvider('m2script.dropEntry', new DropEntryProvider()),
    vscode.window.registerWebviewViewProvider('m2script.colorPicker', new ColorPickerProvider(context)),
    vscode.debug.registerDebugConfigurationProvider('m2script', new M2DebugConfigProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('m2script', new M2DebugAdapterFactory()),
    vscode.commands.registerCommand('m2script.refreshVars', () => panel.refresh()),
    vscode.commands.registerCommand('m2script.openColorPicker', async (line?: number, character?: number) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && line !== undefined && character !== undefined) {
        editor.selection = new vscode.Selection(line, character, line, character);
      }
      await vscode.commands.executeCommand('m2script.colorPicker.focus');
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
        diagnostics.update(editor.document);
        await promptReopenAsGbk(editor.document, true);
      }
    }),
  );

  context.subscriptions.push(new M2CrossFileHighlighter());

  // 内容嗅探与静态检查: 已打开 + 新打开 + 编辑中的脚本
  const sniffAndLint = async (doc: vscode.TextDocument) => {
    await sniffDocument(doc);
    diagnostics.update(doc);
  };
  for (const doc of vscode.workspace.textDocuments) void sniffAndLint(doc);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => void sniffAndLint(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => diagnostics.schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('m2script.diagnostics.fullwidthPunctuation')) return;
      for (const doc of vscode.workspace.textDocuments) diagnostics.update(doc);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const navigation = consumeColorNavigation(e.textEditor);
      if (navigation) void vscode.commands.executeCommand('m2script.openColorPicker', navigation.line, navigation.character);
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

  // 变量索引: 先恢复上次缓存, 再后台校验变化文件; 单文件事件由 VarScanner 自行处理
  void scanner.initialize().catch((e) => {
    console.error('[M2Script] 变量索引初始化失败:', e);
  });
}

export function deactivate() {
  return activeScanner?.flush();
}

