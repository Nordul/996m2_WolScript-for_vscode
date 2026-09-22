import * as vscode from 'vscode';
import paletteData from '../data/colorPalette.json';

/** 0-255 调色板(官方颜色对照表), 索引即编号, 值为6位16进制 */
const PALETTE = paletteData as string[];

// color=224  (UI组件属性, 0-255调色板编号)
const PALETTE_RE = /\bcolor=(\d{1,3})(?!\d)/gi;
// #0xffffa500  (#0x + AARRGGBB)
const HEXA_RE = /#0x([0-9a-fA-F]{8})(?![0-9a-fA-F])/g;
// ffa500  (等号后的6位16进制, 且至少含一个a-f字母以免误伤纯数字)
const HEX_RE = /(?<==)(?=[0-9a-fA-F]*[a-fA-F])([0-9a-fA-F]{6})(?![0-9a-fA-F])/g;

function rgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function toHex2(v: number): string {
  return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
}

/** 在 0-255 调色板中找与给定颜色最接近的编号 */
export function nearestPaletteIndex(color: vscode.Color): number {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = rgb(PALETTE[i]);
    const d = (p.r - color.red) ** 2 + (p.g - color.green) ** 2 + (p.b - color.blue) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

export class M2ColorProvider implements vscode.DocumentColorProvider {
  provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
    const infos: vscode.ColorInformation[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;

      for (const m of line.matchAll(PALETTE_RE)) {
        const idx = parseInt(m[1], 10);
        if (idx > 255) continue;
        const start = m.index! + m[0].length - m[1].length;
        const { r, g, b } = rgb(PALETTE[idx]);
        infos.push(new vscode.ColorInformation(
          new vscode.Range(i, start, i, start + m[1].length),
          new vscode.Color(r, g, b, 1),
        ));
      }

      for (const m of line.matchAll(HEXA_RE)) {
        const hex = m[1];
        const { r, g, b } = rgb(hex.slice(2));
        infos.push(new vscode.ColorInformation(
          new vscode.Range(i, m.index!, i, m.index! + m[0].length),
          new vscode.Color(r, g, b, parseInt(hex.slice(0, 2), 16) / 255),
        ));
      }

      for (const m of line.matchAll(HEX_RE)) {
        // 与 #0x 形式重叠时跳过(#0x... 中 = 后面的部分不会被匹配, 因为前缀是 #)
        const { r, g, b } = rgb(m[1]);
        infos.push(new vscode.ColorInformation(
          new vscode.Range(i, m.index!, i, m.index! + m[1].length),
          new vscode.Color(r, g, b, 1),
        ));
      }
    }
    return infos;
  }

  provideColorPresentations(
    color: vscode.Color,
    context: { document: vscode.TextDocument; range: vscode.Range },
  ): vscode.ColorPresentation[] {
    const oldText = context.document.lineAt(context.range.start.line).text
      .slice(context.range.start.character, context.range.end.character);

    // color=224 调色板编号: 选中的颜色映射回最近的 0-255 编号
    if (/^\d{1,3}$/.test(oldText)) {
      return [new vscode.ColorPresentation(String(nearestPaletteIndex(color)))];
    }
    // #0xAARRGGBB
    if (/^#0x/i.test(oldText)) {
      const alpha = toHex2(color.alpha);
      return [new vscode.ColorPresentation(`#0x${alpha}${toHex2(color.red)}${toHex2(color.green)}${toHex2(color.blue)}`)];
    }
    // RRGGBB
    return [new vscode.ColorPresentation(`${toHex2(color.red)}${toHex2(color.green)}${toHex2(color.blue)}`)];
  }
}
