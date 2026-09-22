import * as vscode from 'vscode';
import {
  lookupCommand, lookupSysVar, lookupUiComp, lookupVarType, lookupTrigger,
  cmdDocMarkdown,
} from './data';

export class M2HoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const line = document.lineAt(position.line).text;
    const ch = position.character;

    // 1. 系统变量 <$XXX> / <$STR(...)>
    const sysRe = /<\$([A-Za-z][A-Za-z0-9_]*)(?:\([^>]*\))?>/g;
    for (const m of line.matchAll(sysRe)) {
      const start = m.index!, end = start + m[0].length;
      if (ch >= start && ch <= end) {
        const fnName = m[1].toUpperCase();
        if (['STR', 'HUMAN', 'GUILD', 'GLOBAL', 'MONEY', 'BINDMONEY', 'PARAM', 'CUSTOMVALUE'].includes(fnName)) {
          const md = new vscode.MarkdownString(undefined, true);
          md.appendMarkdown(`**<$${m[1]}(...)>** — 变量取值/显示语法\n\n`);
          md.appendMarkdown('[变量操作说明](http://cshelp.996m2.com/web/#/17/970)');
          return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
        }
        const v = lookupSysVar(m[1]);
        if (v) {
          const md = new vscode.MarkdownString(undefined, true);
          md.appendCodeblock(`<$${v.name}>`, 'plaintext');
          md.appendMarkdown(`${v.desc || '系统只读变量'}\n\n[官方文档](${v.docUrl})`);
          return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
        }
        return undefined;
      }
    }

    // 2. UI 组件名 <Name|...>
    const compRe = /<([A-Z][A-Za-z0-9]{1,19})(?=\|)/g;
    for (const m of line.matchAll(compRe)) {
      const start = m.index! + 1, end = start + m[1].length;
      if (ch >= start && ch <= end) {
        const comp = lookupUiComp(m[1]);
        if (!comp) return undefined;
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**UI组件 \`<${comp.name}>\`** — ${comp.desc}\n\n`);
        if (comp.params.length) {
          md.appendMarkdown('| 参数 | 说明 |\n|---|---|\n');
          for (const p of comp.params.slice(0, 15)) md.appendMarkdown(`| ${p.name} | ${p.desc} |\n`);
          md.appendMarkdown('\n');
        }
        md.appendMarkdown(`[官方文档](${comp.docUrl})`);
        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
      }
    }

    // 3. 标签 [@xxx]
    const labelRe = /\[@([^\]\s]+)\]/g;
    for (const m of line.matchAll(labelRe)) {
      const start = m.index!, end = start + m[0].length;
      if (ch >= start && ch <= end) {
        const t = lookupTrigger(m[1]);
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**脚本标签 \`[@${m[1]}]\`**\n\n`);
        if (t) md.appendMarkdown(`引擎触发器: ${t.desc}\n\n[官方文档](${t.docUrl})`);
        else md.appendMarkdown('脚本段落标签, 可被 GOTO / DELAYGOTO / FUNC 等命令跳转调用');
        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
      }
    }

    // 4. 个人标记 [n]
    const markRe = /\[(\d{1,3})\]/g;
    for (const m of line.matchAll(markRe)) {
      const start = m.index!, end = start + m[0].length;
      if (ch >= start && ch <= end) {
        const v = lookupVarType('MARK')!;
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**个人标记 [${m[1]}]** (${v.prefix === 'MARK' ? '1-800' : ''})\n\n${v.desc}`);
        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
      }
    }

    // 5. 类型变量 (S0, A12, M99...)
    const varRe = /\b([ASPDGIMUTJZaspgimutjz])(\d{1,3})\b/g;
    for (const m of line.matchAll(varRe)) {
      const start = m.index!, end = start + m[0].length;
      if (ch >= start && ch <= end) {
        const vt = lookupVarType(m[1]);
        if (!vt) return undefined;
        const idx = parseInt(m[2], 10);
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**${vt.prefix}变量 — ${vt.prefix}${idx}**\n\n`);
        md.appendMarkdown(`- 类型: ${vt.valueType} / ${vt.scope}\n- 范围: ${vt.prefix}${vt.min} - ${vt.prefix}${vt.max}`);
        if (idx > vt.max) md.appendMarkdown(`  ⚠️ **超出范围!**`);
        md.appendMarkdown(`\n- 保存: ${vt.persist}\n\n${vt.desc}\n\n[变量类型说明](http://cshelp.996m2.com/web/#/17/1217)`);
        return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
      }
    }

    // 6. 行首命令
    const cmdMatch = line.match(/^\s*(!?)([A-Za-z][A-Za-z0-9_]*)/);
    if (cmdMatch) {
      const start = line.indexOf(cmdMatch[2], cmdMatch[1] ? line.indexOf('!') + 1 : 0);
      const end = start + cmdMatch[2].length;
      if (ch >= start && ch <= end) {
        const c = lookupCommand(cmdMatch[2]);
        if (c) {
          return new vscode.Hover(cmdDocMarkdown(c), new vscode.Range(position.line, start, position.line, end));
        }
      }
    }

    return undefined;
  }
}
