import * as vscode from 'vscode';

/** 侧边栏「数据库查看器」入口视图：说明 + 打开按钮 */
export class DbEntryProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    view.webview.html = `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); padding: 12px;
  }
  .desc { font-size: 11px; opacity: .6; line-height: 1.7; margin-bottom: 12px; }
  button {
    width: 100%; border: none; border-radius: 6px; cursor: pointer; padding: 7px 0; font-size: 12px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div class="desc">浏览 GameLoad.DB 数据库（物品 StdItems、怪物 Monster、技能 Magic 等约 30 张数据表），并支持脚本内物品/怪物/技能名补全。</div>
  <button id="openBtn">打开数据库查看器</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('openBtn').onclick = () => vscode.postMessage({ type: 'open' });
</script>
</body>
</html>`;
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'open') void vscode.commands.executeCommand('m2script.openDbViewer');
    });
  }
}
