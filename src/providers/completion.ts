import * as vscode from 'vscode';
import {
  actionCommands, checkCommands, sysVariables, uiComponents, triggers, varTypes, sendMsgTypes,
  Cmd, getSectionAt, getDocumentLabels, cmdDocMarkdown, signatureToSnippet,
} from './data';

/** 按已输入字符过滤: 前缀优先, 退化为包含, 都没有则返回全部(不区分大小写) */
function filterByPrefix<T>(items: readonly T[], typed: string, name: (t: T) => string): T[] {
  if (!typed) return items.slice();
  const t = typed.toUpperCase();
  const prefix = items.filter((i) => name(i).toUpperCase().startsWith(t));
  if (prefix.length) return prefix;
  const sub = items.filter((i) => name(i).toUpperCase().includes(t));
  return sub.length ? sub : items.slice();
}

function commandItem(c: Cmd): vscode.CompletionItem {
  const item = new vscode.CompletionItem(c.name, c.kind === 'check' ? vscode.CompletionItemKind.Operator : vscode.CompletionItemKind.Function);
  item.detail = c.signature !== c.name ? c.signature : undefined;
  item.documentation = cmdDocMarkdown(c);
  item.insertText = signatureToSnippet(c.signature, c.name);
  // 检测命令排在执行命令前(同字母时)
  item.sortText = (c.kind === 'check' ? '0' : '1') + c.name.toUpperCase();
  // SENDMSG 插入后立即弹出信息类型编号列表(带说明)
  if (c.name.toUpperCase() === 'SENDMSG') {
    item.command = { command: 'editor.action.triggerSuggest', title: '选择信息类型' };
  }
  return item;
}

function sysVarItem(v: { name: string; form?: string; desc: string; docUrl: string }): vscode.CompletionItem {
  const item = new vscode.CompletionItem(`$${v.name}`, vscode.CompletionItemKind.Variable);
  // 必须用 SnippetString 并转义 $, 否则 $USERNAME 会被当作 snippet 变量吃掉
  // 带参数形态: <$CUSTOMVALUE(A)> / <$HUMANINFO[A].B> / <$GUILD.A> 给出占位符
  let snip: string;
  const form = v.form || v.name;
  if (/\[/.test(form)) {
    snip = `\\$${v.name}[\${1:A}]`;
    if (/\]\s*\./.test(form)) snip += `.\${2:B}`;
    snip += '>';
  } else if (/\(/.test(form)) {
    snip = `\\$${v.name}(\${1:A})`;
    if (/\)\s*\./.test(form)) snip += `.\${2:B}`;
    snip += '>';
  } else if (/\./.test(form)) {
    snip = `\\$${v.name}.\${1:A}>`;
  } else {
    snip = `\\$${v.name}>`;
  }
  item.insertText = new vscode.SnippetString(snip);
  item.detail = '系统变量';
  const md = new vscode.MarkdownString(undefined, true);
  md.appendCodeblock(`<$${form}>`, 'plaintext');
  md.appendMarkdown(`${v.desc || ''}\n\n[官方文档](${v.docUrl})`);
  item.documentation = md;
  return item;
}

function uiCompItem(c: typeof uiComponents[number]): vscode.CompletionItem {
  const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class);
  const paramNames = c.params.slice(0, 8).map((p) => p.name);
  const preferred = ['x', 'y', 'text', 'nimg', 'link'].filter((p) => paramNames.includes(p));
  const rest = paramNames.filter((p) => !preferred.includes(p));
  const ordered = [...preferred, ...rest].slice(0, 5);
  let snip = `${c.name}`;
  ordered.forEach((p, i) => { snip += `|${p}=\${${i + 1}:}`; });
  item.insertText = new vscode.SnippetString(snip + '>$0');
  item.detail = `UI组件 - ${c.desc}`;
  const md = new vscode.MarkdownString(undefined, true);
  md.appendCodeblock(`<${c.name}|x=|y=|...>`, 'plaintext');
  md.appendMarkdown(`**${c.desc}**\n\n`);
  if (c.params.length) {
    md.appendMarkdown('| 参数 | 说明 |\n|---|---|\n');
    for (const p of c.params.slice(0, 12)) md.appendMarkdown(`| ${p.name} | ${p.desc} |\n`);
    md.appendMarkdown('\n');
  }
  md.appendMarkdown(`[官方文档](${c.docUrl})`);
  item.documentation = md;
  return item;
}

export class M2CompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position.line).text;
    const before = lineText.slice(0, position.character);
    // 已输入字符的替换范围: 让 VSCode 过滤/插入与已输入部分精确对齐
    const rangeFrom = (len: number) => new vscode.Range(position.line, position.character - len, position.line, position.character);

    // 1. `<`/`<<`/`<$xxx`/`<组件名前缀` 之后: 系统变量 / UI 组件
    const ltMatch = before.match(/<{1,2}(\$?[A-Za-z0-9_]*)$/);
    if (ltMatch) {
      const typed = ltMatch[1];
      if (typed.startsWith('$')) {
        return filterByPrefix(sysVariables, typed.slice(1), (v) => v.name).map((v) => {
          const item = sysVarItem(v);
          item.range = rangeFrom(typed.length);
          return item;
        });
      }
      const items: vscode.CompletionItem[] = [];
      const dollar = new vscode.CompletionItem('$变量', vscode.CompletionItemKind.Snippet);
      dollar.insertText = new vscode.SnippetString('\\$${1:USERNAME}>');
      dollar.detail = '系统变量 <$...>';
      dollar.sortText = '0';
      dollar.range = rangeFrom(typed.length);
      items.push(dollar);
      const strCall = new vscode.CompletionItem('$STR(变量)', vscode.CompletionItemKind.Snippet);
      strCall.insertText = new vscode.SnippetString('\\$STR(${1:S0})>');
      strCall.detail = '变量取值 <$STR(...)>';
      strCall.sortText = '01';
      strCall.range = rangeFrom(typed.length);
      items.push(strCall);
      const bindMoney = new vscode.CompletionItem('$BINDMONEY(货币)', vscode.CompletionItemKind.Snippet);
      bindMoney.insertText = new vscode.SnippetString('\\$BINDMONEY(${1:元宝})>');
      bindMoney.detail = '组合货币数量 <$BINDMONEY(货币ID/名称/分组名)>';
      bindMoney.sortText = '02';
      bindMoney.range = rangeFrom(typed.length);
      items.push(bindMoney);
      for (const c of filterByPrefix(uiComponents, typed, (x) => x.name)) {
        const item = uiCompItem(c);
        item.range = rangeFrom(typed.length);
        items.push(item);
      }
      return items;
    }

    // 2. UI 组件内部: 补全参数名 (光标处于参数值内则不提示)
    const compMatch = before.match(/<([A-Z][A-Za-z0-9]{1,19})\|[^>]*$/);
    if (compMatch && !/>\s*[^<]*$/.test(before)) {
      if (/\|[^|]*=[^|]*$/.test(before)) return undefined;
      const comp = uiComponents.find((c) => c.name.toUpperCase() === compMatch[1].toUpperCase());
      if (comp) {
        const typed = (before.match(/\|([A-Za-z]*)$/) || [])[1] || '';
        return filterByPrefix(comp.params, typed, (p) => p.name).map((p) => {
          const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
          item.insertText = new vscode.SnippetString(`${p.name}=\${1:}`);
          item.detail = `${comp.name} 参数`;
          item.documentation = p.desc;
          item.range = rangeFrom(typed.length);
          return item;
        });
      }
    }

    // 3. $STR( / <$STR( 内: 变量类型引导
    const strMatch = before.match(/\$[A-Za-z]*\(([A-Za-z0-9_]*)$/);
    if (strMatch) {
      const typed = strMatch[1];
      return filterByPrefix(
        varTypes.filter((v) => !['MARK', 'CUSTOM', 'CV'].includes(v.prefix)),
        typed,
        (v) => v.prefix,
      ).map((v) => {
        const item = new vscode.CompletionItem(`${v.prefix} (${v.prefix}${v.min}-${v.prefix}${v.max})`, vscode.CompletionItemKind.Variable);
        item.insertText = v.prefix;
        item.filterText = v.prefix;
        item.detail = `${v.valueType} ${v.scope} ${v.persist}`;
        item.documentation = v.desc;
        item.range = rangeFrom(typed.length);
        return item;
      });
    }

    // 4. $ 开头: 取值函数
    if (/\$$/.test(before)) {
      const fn = (label: string, snip: string, doc: string) => {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(snip);
        item.documentation = doc;
        return item;
      };
      return [
        fn('STR(变量)', 'STR(${1:S0})', '显示/读取变量值, 如 $STR(S0)'),
        fn('PARAM(n)', 'PARAM(${1:0})', '触发参数变量, 如 $PARAM(0)'),
      ];
    }

    // 5. @ 之后: 当前文档标签 + 触发器
    const atMatch = before.match(/@([A-Za-z0-9_一-龥]*)$/);
    if (atMatch) {
      const typed = atMatch[1];
      const items: vscode.CompletionItem[] = [];
      const atLineStart = /^\s*\[?@[A-Za-z0-9_]*$/.test(before);
      if (atLineStart) {
        for (const t of filterByPrefix(triggers, typed, (x) => x.name)) {
          const item = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Event);
          item.detail = '引擎触发器';
          item.documentation = `${t.desc} — [官方文档](${t.docUrl})`;
          item.range = rangeFrom(typed.length);
          items.push(item);
        }
      }
      for (const label of filterByPrefix(getDocumentLabels(document), typed, (x) => x)) {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
        item.detail = '本文档标签';
        item.range = rangeFrom(typed.length);
        items.push(item);
      }
      return items.length ? items : undefined;
    }

    // 6. # 之后: 段关键字 + #CALL
    const hashMatch = before.match(/^\s*#([A-Za-z]*)$/);
    if (hashMatch) {
      const typed = hashMatch[1].toUpperCase();
      const items = ['IF', 'ACT', 'SAY', 'ELSEACT', 'ELSESAY']
        .filter((k) => k.startsWith(typed))
        .map((k) => {
          const item = new vscode.CompletionItem(`#${k}`, vscode.CompletionItemKind.Keyword);
          item.insertText = k;
          item.filterText = k;
          item.detail = '脚本段标记';
          item.range = rangeFrom(typed.length);
          return item;
        });
      if ('CALL'.startsWith(typed)) {
        const call = new vscode.CompletionItem('#CALL', vscode.CompletionItemKind.Function);
        call.insertText = new vscode.SnippetString('CALL [${1:子目录\\\\文件.txt}] @${2:标签}');
        call.filterText = 'CALL';
        call.detail = '读取QuestDiary内指定文件的指定标签';
        call.documentation = '#CALL [\\文件路径\\文件.txt] @标签 — 调用 QuestDiary 文件夹内对应文件的对应标签段';
        call.range = rangeFrom(typed.length);
        items.push(call);
      }
      return items;
    }

    // 7. SENDMSG 第一个参数: 信息类型编号选择
    const sendmsgMatch = before.match(/^\s*SENDMSG\s+([0-9]*)$/i);
    if (sendmsgMatch) {
      const typed = sendmsgMatch[1];
      return sendMsgTypes
        .filter((t) => String(t.n).startsWith(typed))
        .map((t) => {
          const item = new vscode.CompletionItem(`${t.n} ${t.desc}`, vscode.CompletionItemKind.EnumMember);
          // 选中编号后直接带上 B 字段占位符: 选完 A 即处于内容编辑状态, 且 B 之后无多余 Tab 位
          item.insertText = new vscode.SnippetString(`${t.n} \${1:文字内容}`);
          item.filterText = String(t.n);
          item.sortText = String(t.n).padStart(2, '0');
          item.detail = 'SENDMSG 信息类型';
          item.range = rangeFrom(typed.length);
          return item;
        });
    }

    // 8. 行首命令补全: 按段落上下文过滤
    const lineStartMatch = before.match(/^(\s*)(!?)([A-Za-z0-9_]*)$/);
    if (lineStartMatch) {
      const negated = lineStartMatch[2] === '!';
      const typed = lineStartMatch[3];
      const section = getSectionAt(document, position);
      const withRange = (c: Cmd) => {
        const item = commandItem(c);
        item.range = rangeFrom(typed.length);
        return item;
      };

      if (negated || section === 'if') {
        // #IF 段: 仅检测命令
        return filterByPrefix(checkCommands, typed, (c) => c.name).map(withRange);
      }
      if (section === 'act' || section === 'elseact') {
        // #ACT 段: 仅执行命令
        return filterByPrefix(actionCommands, typed, (c) => c.name).map(withRange);
      }
      if (section === 'say' || section === 'elsesay') {
        // #SAY 段: 文本模式, 提供变量与 UI 组件
        const lt = new vscode.CompletionItem('<组件/变量>', vscode.CompletionItemKind.Snippet);
        lt.insertText = new vscode.SnippetString('<${1|\\$USERNAME,Text,RText,Img,Button,Layout|}');
        lt.detail = 'SAY 段可嵌入变量与UI组件';
        lt.range = rangeFrom(typed.length);
        return [lt];
      }
      // 无段上下文: 全部命令
      return filterByPrefix([...checkCommands, ...actionCommands], typed, (c) => c.name).map(withRange);
    }

    return undefined;
  }
}
