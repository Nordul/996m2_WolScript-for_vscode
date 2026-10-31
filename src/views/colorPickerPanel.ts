import * as vscode from 'vscode';
import paletteData from '../data/colorPalette.json';

const PALETTE = paletteData as string[];

export type ColorOutputFormat = 'palette' | 'hex';
export type ColorCodeKind = ColorOutputFormat | 'bareHex';

export interface ColorCodeMatch {
  start: number;
  end: number;
  text: string;
  kind: ColorCodeKind;
  index?: number;
  hex?: string;
}

function nearestPaletteIndex(hex: string): number {
  const exact = PALETTE.indexOf(hex);
  if (exact >= 0) return exact;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    const dist = (parseInt(p.slice(0, 2), 16) - r) ** 2
      + (parseInt(p.slice(2, 4), 16) - g) ** 2
      + (parseInt(p.slice(4, 6), 16) - b) ** 2;
    if (dist < bestDist) { best = i; bestDist = dist; }
  }
  return best;
}

export function colorCodeAtCursor(line: string, character: number): ColorCodeMatch | undefined {
  for (const m of line.matchAll(/\bcolor=(\d{1,3})(?!\d)/gi)) {
    const start = m.index!, end = start + m[0].length;
    const index = parseInt(m[1], 10);
    if (index <= 255 && character >= start && character <= end) {
      return { start, end, text: m[0], kind: 'palette', index, hex: PALETTE[index] };
    }
  }
  for (const m of line.matchAll(/#0x([0-9a-fA-F]{8})(?![0-9a-fA-F])/g)) {
    const start = m.index!, end = start + m[0].length;
    if (character >= start && character <= end) {
      const hex = m[1].slice(2).toLowerCase();
      return { start, end, text: m[0], kind: 'hex', index: nearestPaletteIndex(hex), hex };
    }
  }
  for (const m of line.matchAll(/\bcolor=([0-9a-fA-F]{6})(?![0-9a-fA-F])/g)) {
    const start = m.index!, end = start + m[0].length;
    if (character >= start && character <= end) {
      const hex = m[1].toLowerCase();
      return { start, end, text: m[0], kind: 'bareHex', index: nearestPaletteIndex(hex), hex };
    }
  }
  return undefined;
}

export function colorText(index: number, format: ColorCodeKind): string | undefined {
  const hex = PALETTE[index];
  if (!hex) return undefined;
  if (format === 'bareHex') return `color=${hex}`;
  return format === 'hex' ? `#0xff${hex}` : `color=${index}`;
}

export function colorEditAtCursor(
  line: string,
  character: number,
  index: number,
  format: ColorOutputFormat,
): { start: number; end: number; newText: string } | undefined {
  const current = colorCodeAtCursor(line, character);
  const newText = colorText(index, current?.kind === 'bareHex' ? 'bareHex' : format);
  if (!newText) return undefined;
  return current
    ? { start: current.start, end: current.end, newText }
    : { start: character, end: character, newText };
}

export function hexColorText(hex: string, format: ColorCodeKind): string | undefined {
  const normalized = hex.replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) return undefined;
  return format === 'bareHex' ? `color=${normalized}` : `#0xff${normalized}`;
}

export function hexColorEditAtCursor(
  line: string,
  character: number,
  hex: string,
  format: ColorOutputFormat,
): { start: number; end: number; newText: string } | undefined {
  const current = colorCodeAtCursor(line, character);
  const newText = hexColorText(hex, current?.kind === 'bareHex' ? 'bareHex' : format);
  if (!newText) return undefined;
  return current
    ? { start: current.start, end: current.end, newText }
    : { start: character, end: character, newText };
}

export function colorPickerFormat(current: ColorCodeMatch | undefined, fallback: ColorOutputFormat): ColorOutputFormat {
  if (!current) return fallback;
  return current.kind === 'palette' ? 'palette' : 'hex';
}

export class ColorPickerProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private format: ColorOutputFormat = 'palette';

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderHtml();
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') this.postState();
      else if (msg.type === 'format') {
        this.format = msg.format === 'hex' ? 'hex' : 'palette';
        this.postState();
      } else if (msg.type === 'pick') {
        void this.applyColor(msg.index, msg.format === 'hex' ? 'hex' : 'palette');
      } else if (msg.type === 'pickHex') {
        void this.applyHexColor(msg.hex, msg.format === 'hex' ? 'hex' : 'palette');
      }
    }, null, this.context.subscriptions);
    this.context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(() => this.postState()),
      vscode.window.onDidChangeActiveTextEditor(() => this.postState()),
    );
    this.postState();
  }

  private async applyColor(index: number, format: ColorOutputFormat): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const position = editor.selection.active;
    const edit = colorEditAtCursor(editor.document.lineAt(position.line).text, position.character, index, format);
    await this.applyEdit(edit, format);
  }

  private async applyHexColor(hex: string, format: ColorOutputFormat): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const position = editor.selection.active;
    const edit = hexColorEditAtCursor(editor.document.lineAt(position.line).text, position.character, hex, format);
    await this.applyEdit(edit, format);
  }

  private async applyEdit(
    edit: { start: number; end: number; newText: string } | undefined,
    format: ColorOutputFormat,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !edit) return;
    const position = editor.selection.active;
    const range = new vscode.Range(position.line, edit.start, position.line, edit.end);
    const applied = await editor.edit((builder) => builder.replace(range, edit.newText));
    if (applied) {
      this.format = format;
      this.postState();
    }
  }

  private postState(): void {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    const position = editor?.selection.active;
    const current = editor && position
      ? colorCodeAtCursor(editor.document.lineAt(position.line).text, position.character)
      : undefined;
    void this.view.webview.postMessage({
      type: 'state',
      palette: PALETTE,
      format: colorPickerFormat(current, this.format),
      selected: current?.index ?? -1,
      currentText: current?.text || '',
      currentHex: current?.hex || '',
      currentKind: current?.kind || '',
      hasEditor: !!editor,
    });
  }

  private renderHtml(): string {
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    return /* html */ `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 10px; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .title { font-size: 13px; font-weight: 600; }
  select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35)); border-radius: 4px; padding: 3px 5px; }
  .preview { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; min-height: 28px; }
  #currentColor { width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.4)); flex: none; }
  #currentText { font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .75; word-break: break-all; }
  #palette { display: grid; grid-template-columns: repeat(auto-fill, minmax(20px, 1fr)); gap: 4px; }
  .swatch { aspect-ratio: 1; min-width: 0; padding: 0; border: 1px solid rgba(128,128,128,.35); border-radius: 4px; cursor: pointer; }
  .swatch:hover { outline: 2px solid var(--vscode-focusBorder); outline-offset: 0; }
  .swatch.selected { outline: 2px solid var(--vscode-charts-blue, #3794ff); outline-offset: 0; }
  .hex-tools { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); }
  .hex-tools[hidden] { display: none; }
  .hex-tools label { display: block; margin-bottom: 6px; font-size: 11px; opacity: .75; }
  #hexPicker { display: block; width: 100%; height: 36px; padding: 2px; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35)); border-radius: 4px; background: var(--vscode-input-background); cursor: pointer; }
  .hint { margin-top: 10px; font-size: 10px; opacity: .55; line-height: 1.6; }
</style>
</head>
<body>
  <div class="toolbar"><span class="title" id="modeTitle">颜色选择</span><select id="format" aria-label="颜色格式"><option value="palette">256 色</option><option value="hex">16 进制</option></select></div>
  <div class="preview"><div id="currentColor"></div><div id="currentText">在编辑器中选择颜色代码</div></div>
  <div class="hex-tools" id="hexTools" hidden><label for="hexPicker">自定义 16 进制颜色</label><input id="hexPicker" type="color" value="#000000"></div>
  <div id="palette"></div>
  <div class="hint">点击颜色插入或替换光标处代码。16 进制模式下可使用自定义调色盘，也可点击 256 色卡转换。</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const paletteEl = document.getElementById('palette');
  const formatEl = document.getElementById('format');
  const modeTitle = document.getElementById('modeTitle');
  const currentColor = document.getElementById('currentColor');
  const currentText = document.getElementById('currentText');
  const hexTools = document.getElementById('hexTools');
  const hexPicker = document.getElementById('hexPicker');
  let state = { palette: [], format: 'palette', selected: -1, currentText: '', currentHex: '', currentKind: '', hasEditor: false };

  function codeFor(index) { return state.format === 'hex' ? '#0xff' + state.palette[index] : 'color=' + index; }
  function renderPalette() {
    paletteEl.textContent = '';
    state.palette.forEach((hex, index) => {
      const button = document.createElement('button');
      button.className = 'swatch' + (state.selected === index ? ' selected' : '');
      button.style.background = '#' + hex;
      button.title = codeFor(index);
      button.setAttribute('aria-label', codeFor(index));
      button.addEventListener('click', () => vscode.postMessage({ type: 'pick', index, format: state.format }));
      paletteEl.appendChild(button);
    });
  }
  function renderPreview() {
    currentColor.style.background = state.currentHex ? '#' + state.currentHex : (state.selected >= 0 ? '#' + state.palette[state.selected] : 'transparent');
    currentText.textContent = state.currentText || (state.hasEditor ? '在编辑器中选择颜色代码' : '未打开编辑器');
    modeTitle.textContent = !state.currentKind ? '颜色选择' : (state.format === 'palette' ? '256 色板' : '16 进制调色盘');
    formatEl.hidden = !!state.currentKind;
    formatEl.value = state.format;
    hexTools.hidden = state.format !== 'hex';
    if (/^[0-9a-f]{6}$/.test(state.currentHex)) hexPicker.value = '#' + state.currentHex;
    renderPalette();
  }
  formatEl.addEventListener('change', () => {
    state.format = formatEl.value;
    vscode.postMessage({ type: 'format', format: state.format });
    renderPreview();
  });
  hexPicker.addEventListener('change', () => {
    vscode.postMessage({ type: 'pickHex', hex: hexPicker.value.slice(1), format: 'hex' });
  });
  window.addEventListener('message', (event) => {
    if (event.data.type !== 'state') return;
    state = event.data;
    renderPreview();
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
