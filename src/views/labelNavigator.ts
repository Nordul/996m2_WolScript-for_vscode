import * as vscode from 'vscode';
import * as path from 'path';
import { isWorkspaceScheme } from '../workspaceUri';
import { filterScriptLabels, parseScriptLabels, ScriptLabel } from './labelNavigatorCore';

class LabelItem extends vscode.TreeItem {
  constructor(document: vscode.TextDocument, label: ScriptLabel) {
    super(`@${label.name}`, vscode.TreeItemCollapsibleState.None);
    this.id = `${document.uri.toString()}:${label.line}`;
    this.description = `第 ${label.line + 1} 行`;
    this.tooltip = `[@${label.name}]\n${path.basename(document.uri.fsPath)}:${label.line + 1}`;
    this.iconPath = new vscode.ThemeIcon('tag');
    this.contextValue = 'm2scriptLabel';
    this.accessibilityInformation = { label: `@${label.name}，第 ${label.line + 1} 行` };
    this.command = {
      command: 'm2script.goToLabel',
      title: '跳转到标签',
      arguments: [document.uri, label],
    };
  }
}

export class LabelNavigatorProvider implements vscode.TreeDataProvider<LabelItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<LabelItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private document?: vscode.TextDocument;
  private labels: ScriptLabel[] = [];
  private query = '';
  private view?: vscode.TreeView<LabelItem>;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== this.document) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 120);
      }),
    );
  }

  attachView(view: vscode.TreeView<LabelItem>): void {
    this.view = view;
    this.refresh();
  }

  getTreeItem(element: LabelItem): vscode.TreeItem {
    return element;
  }

  getChildren(): LabelItem[] {
    return this.document ? filterScriptLabels(this.labels, this.query).map((label) => new LabelItem(this.document!, label)) : [];
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(query: string): void {
    this.query = query;
    this.updateView();
    this.emitter.fire(undefined);
  }

  refresh(): void {
    const editor = vscode.window.activeTextEditor;
    this.document = editor && isWorkspaceScheme(editor.document.uri.scheme) ? editor.document : undefined;
    this.labels = this.document ? parseScriptLabels(this.document.getText()) : [];
    this.updateView();
    this.emitter.fire(undefined);
  }

  private updateView(): void {
    if (!this.view) return;
    const fileName = this.document ? path.basename(this.document.uri.fsPath) : '';
    const visibleCount = filterScriptLabels(this.labels, this.query).length;
    this.view.description = this.document
      ? `${fileName} · ${this.query.trim() ? `${visibleCount}/${this.labels.length}` : `${this.labels.length} 个标签`}`
      : undefined;
    this.view.message = !this.document
      ? '打开脚本文件后，可在这里快速跳转 [@xx] 标签。'
      : this.labels.length === 0 ? '当前文件没有 [@xx] 标签。'
        : visibleCount === 0 ? `没有匹配“${this.query.trim()}”的标签。` : undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
    this.emitter.dispose();
  }
}

export class LabelSearchProvider implements vscode.WebviewViewProvider {
  constructor(private readonly navigator: LabelNavigatorProvider) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const query = this.navigator.getQuery()
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    view.webview.html = `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { padding: 7px 8px 4px; overflow: hidden; font-family: var(--vscode-font-family); }
  .search { position: relative; display: flex; align-items: center; }
  input {
    box-sizing: border-box; width: 100%; height: 26px; padding: 3px 26px 3px 7px;
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
    outline: none; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    font-family: inherit; font-size: var(--vscode-font-size);
  }
  input:focus { border-color: var(--vscode-focusBorder); }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  button {
    position: absolute; right: 2px; display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; padding: 0; border: 0; border-radius: 3px; cursor: pointer;
    background: transparent; color: var(--vscode-foreground); font-size: 15px;
  }
  button:hover { background: var(--vscode-toolbar-hoverBackground); }
  button[hidden] { display: none; }
</style>
</head>
<body>
  <div class="search">
    <input id="query" type="text" value="${query}" placeholder="搜索 @标签…" aria-label="搜索当前文件标签" autofocus>
    <button id="clear" title="清除搜索" aria-label="清除搜索" hidden>×</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const input = document.getElementById('query');
  const clear = document.getElementById('clear');
  let timer;
  const update = (immediate = false) => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    const send = () => vscode.postMessage({ type: 'search', query: input.value });
    if (immediate) send();
    else timer = setTimeout(send, 80);
  };
  input.addEventListener('input', () => update());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      input.value = '';
      update(true);
      event.preventDefault();
    }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    update(true);
    input.focus();
  });
  update(true);
</script>
</body>
</html>`;
    view.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'search' && typeof message.query === 'string') this.navigator.setQuery(message.query);
    });
  }
}

export async function goToLabel(uri: vscode.Uri, label: ScriptLabel): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const labels = parseScriptLabels(document.getText()).filter((item) => item.name === label.name);
  const target = labels.find((item) => item.line === label.line) || labels.reduce<ScriptLabel | undefined>(
    (nearest, item) => !nearest || Math.abs(item.line - label.line) < Math.abs(nearest.line - label.line) ? item : nearest,
    undefined,
  );
  if (!target) {
    void vscode.window.showInformationMessage(`未找到标签 [@${label.name}]，它可能已被删除或重命名。`);
    return;
  }
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const range = new vscode.Range(target.line, target.start, target.line, target.end);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
