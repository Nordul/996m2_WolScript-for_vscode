import * as vscode from 'vscode';

export interface RandomStrItem {
  name: string;
  /** 权重原文(可能是变量) */
  weightRaw: string;
  /** 数值权重; 非数值(变量等)为 undefined */
  weight: number | undefined;
}

/** 解析 RandomStr 权重列表: 裁决,10|骨玉,30|龙纹,50 (名字内可能含逗号, 按最后一个逗号切分权重) */
export function parseRandomStrList(list: string): RandomStrItem[] {
  const out: RandomStrItem[] = [];
  for (const g of list.split('|')) {
    const group = g.trim();
    if (!group) continue;
    const i = group.lastIndexOf(',');
    if (i < 0) {
      out.push({ name: group, weightRaw: '', weight: undefined });
      continue;
    }
    const weightRaw = group.slice(i + 1).trim();
    const weight = /^\d+(?:\.\d+)?$/.test(weightRaw) ? parseFloat(weightRaw) : undefined;
    out.push({ name: group.slice(0, i).trim(), weightRaw, weight });
  }
  return out;
}

const RANDOMSTR_RE = /^\s*RandomStr\s+(\S+)\s+\S+/i;

/** RandomStr 行上方提供「模拟权重」入口 */
export class RandomStrCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const out: vscode.CodeLens[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      const m = RANDOMSTR_RE.exec(text);
      if (!m) continue;
      const items = parseRandomStrList(m[1]);
      if (!items.length) continue;
      out.push(new vscode.CodeLens(new vscode.Range(i, 0, i, text.length), {
        title: `⚖ 模拟权重 (${items.length} 项)`,
        command: 'm2script.simRandomStr',
        arguments: [m[1]],
      }));
    }
    return out;
  }
}
