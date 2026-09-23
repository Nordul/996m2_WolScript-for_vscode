import * as vscode from 'vscode';
import { M2CompletionProvider } from './providers/completion';
import { M2HoverProvider } from './providers/hover';
import { M2DefinitionProvider } from './providers/definition';
import { M2FoldingProvider } from './providers/folding';
import { M2ColorProvider } from './providers/color';
import { VarScanner } from './scanner/varScanner';
import { VarPanelProvider } from './views/varPanel';
import { M2DebugConfigProvider, M2DebugAdapterFactory } from './debug/configProvider';

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

  const selector: vscode.DocumentSelector = { language: 'm2script', scheme: 'file' };
  // 字母也作为触发字符: 即使用户关闭了 quickSuggestions, 输入命令字母也能弹出补全
  const letterTriggers = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new M2CompletionProvider(), '<', '$', '@', '#', '!', '(', '|', ...letterTriggers),
    vscode.languages.registerHoverProvider(selector, new M2HoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new M2DefinitionProvider()),
    vscode.languages.registerFoldingRangeProvider(selector, new M2FoldingProvider()),
    vscode.languages.registerColorProvider(selector, new M2ColorProvider()),
    vscode.window.registerWebviewViewProvider('m2script.varPanel', panel),
    vscode.debug.registerDebugConfigurationProvider('m2script', new M2DebugConfigProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('m2script', new M2DebugAdapterFactory()),
    vscode.commands.registerCommand('m2script.refreshVars', () => panel.refresh()),
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

  // 变量扫描: 不自动扫描, 由面板刷新按钮 / m2script.refreshVars 命令手动触发
  context.subscriptions.push(
    // 注释颜色装饰: 初始 + 切换编辑器 + 内容变更
    vscode.window.onDidChangeActiveTextEditor((editor) => updateCommentDecos(editor)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) updateCommentDecos(editor);
    }),
  );
  updateCommentDecos(vscode.window.activeTextEditor);
}

export function deactivate() {}

/** 注释装饰: 主题对 comment 着色不可控(且语言级 tokenColorCustomizations 不支持 textMateRules),
 *  用装饰器强制 ; 与 // 注释为暗灰色, 与语法高亮的注释范围保持一致 */
const SEMI_COMMENT_RE = /(^|\s);/;
const SLASH_COMMENT_RE = /\s(\/\/)/;

const commentDeco = vscode.window.createTextEditorDecorationType({ color: '#6A737D' });

function updateCommentDecos(editor?: vscode.TextEditor): void {
  if (!editor || editor.document.languageId !== 'm2script') return;
  const ranges: vscode.Range[] = [];
  for (let i = 0; i < editor.document.lineCount; i++) {
    const raw = editor.document.lineAt(i).text;
    let start = -1;
    const sm = raw.match(SEMI_COMMENT_RE);
    if (sm) start = sm.index! + sm[1].length;
    const dm = raw.match(SLASH_COMMENT_RE);
    if (dm && (start < 0 || dm.index! + 1 < start)) start = dm.index! + 1;
    if (start >= 0) ranges.push(new vscode.Range(i, start, i, raw.length));
  }
  editor.setDecorations(commentDeco, ranges);
}
