import * as vscode from 'vscode';
import commandsData from '../data/commands.json';
import checkCommandsData from '../data/checkCommands.json';
import sysVariablesData from '../data/sysVariables.json';
import uiComponentsData from '../data/uiComponents.json';
import triggersData from '../data/triggers.json';
import varTypesData from '../data/varTypes.json';
import sendMsgTypesData from '../data/sendMsgTypes.json';

export interface Cmd { name: string; signature: string; desc: string; kind: string; docUrl: string; }
export interface SysVar { name: string; form?: string; desc: string; docUrl: string; }
export interface UiComp { name: string; params: { name: string; desc: string }[]; desc: string; docUrl: string; }
export interface Trigger { name: string; desc: string; docUrl: string; }
export interface VarType { prefix: string; min: number; max: number; valueType: string; scope: string; persist: string; desc: string; writable: boolean; }

export const actionCommands = commandsData as Cmd[];
export const checkCommands = checkCommandsData as Cmd[];
export const sysVariables = sysVariablesData as SysVar[];
export const uiComponents = uiComponentsData as UiComp[];
export const triggers = triggersData as Trigger[];
export const varTypes = (varTypesData as { varTypes: VarType[] }).varTypes;
export const sendMsgTypes = sendMsgTypesData as { n: number; desc: string }[];

export const allCommands: Cmd[] = [...actionCommands, ...checkCommands];

const cmdMap = new Map<string, Cmd>();
for (const c of allCommands) if (!cmdMap.has(c.name.toUpperCase())) cmdMap.set(c.name.toUpperCase(), c);
export function lookupCommand(name: string): Cmd | undefined { return cmdMap.get(name.toUpperCase()); }

const sysVarMap = new Map<string, SysVar>();
for (const v of sysVariables) sysVarMap.set(v.name.toUpperCase(), v);
export function lookupSysVar(name: string): SysVar | undefined { return sysVarMap.get(name.toUpperCase()); }

const uiCompMap = new Map<string, UiComp>();
for (const c of uiComponents) uiCompMap.set(c.name.toUpperCase(), c);
export function lookupUiComp(name: string): UiComp | undefined { return uiCompMap.get(name.toUpperCase()); }

const triggerMap = new Map<string, Trigger>();
for (const t of triggers) triggerMap.set(t.name.toUpperCase(), t);
export function lookupTrigger(name: string): Trigger | undefined { return triggerMap.get(name.toUpperCase()); }

const varTypeMap = new Map<string, VarType>();
for (const v of varTypes) varTypeMap.set(v.prefix, v);
export function lookupVarType(prefix: string): VarType | undefined { return varTypeMap.get(prefix.toUpperCase()); }

export type SectionKind = 'if' | 'act' | 'say' | 'elseact' | 'elsesay' | null;

/** 从光标位置向上扫描, 定位所在的脚本段 (#IF/#ACT/#SAY/...) */
export function getSectionAt(document: vscode.TextDocument, position: vscode.Position): SectionKind {
  for (let line = position.line; line >= 0 && line > position.line - 400; line--) {
    const text = document.lineAt(line).text;
    if (line === position.line) {
      const before = text.slice(0, position.character);
      const m = before.match(/^\s*#\s*(IF|ACT|SAY|ELSEACT|ELSESAY)\s*$/i);
      if (m) continue; // 光标就在段标记行上, 继续向上找上一段? 不, 段标记行本身算该段
    }
    const sec = text.match(/^\s*#\s*(IF|ACT|SAY|ELSEACT|ELSESAY)\b/i);
    if (sec) return sec[1].toLowerCase() as SectionKind;
    if (/^\s*\[@[^\]]*\]/.test(text)) return null; // 遇到标签边界
  }
  return null;
}

/** 提取当前文档内定义的全部 [@标签] */
export function getDocumentLabels(document: vscode.TextDocument): string[] {
  const labels: string[] = [];
  const re = /^\s*\[@([^\]\s]+)\]/;
  for (let i = 0; i < document.lineCount; i++) {
    const m = document.lineAt(i).text.match(re);
    if (m) labels.push(m[1]);
  }
  return labels;
}

export function cmdDocMarkdown(c: Cmd): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendCodeblock(c.signature || c.name, 'plaintext');
  if (c.desc) md.appendMarkdown(`${c.desc}\n\n`);
  md.appendMarkdown(`[官方文档](${c.docUrl})`);
  return md;
}

/** 把 "GIVE A B C D" 签名转成 snippet 占位符 */
export function signatureToSnippet(signature: string, name: string): vscode.SnippetString {
  // SENDMSG 特判: 省略 C/D 颜色字段; 仅插入命令名, A字段由补全列表(带编号说明)接续
  if (name.toUpperCase() === 'SENDMSG') {
    return new vscode.SnippetString('SENDMSG ');
  }
  const tokens = signature.trim().split(/\s+/).slice(1)
    .filter((t) => /^[A-Za-z0-9_]+$/.test(t))
    .slice(0, 6);
  let snip = name;
  tokens.forEach((t, i) => { snip += ` \${${i + 1}:${t}}`; });
  // $0 紧跟最后一个字段(不加空格): 最后一次 Tab 原地结束补全, 无多余跳转位
  if (tokens.length > 0) snip += '$0';
  return new vscode.SnippetString(snip);
}
