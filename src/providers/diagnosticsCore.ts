import actionCommandsData from '../data/commands.json';
import checkCommandsData from '../data/checkCommands.json';
import sysVariablesData from '../data/sysVariables.json';
import { stripComment } from '../scanner/scanCore';

export type DiagnosticCode =
  | 'action-in-if'
  | 'check-in-act'
  | 'command-outside-section'
  | 'command-in-say'
  | 'standalone-variable'
  | 'unclosed-bracket'
  | 'unmatched-bracket'
  | 'fullwidth-punctuation';

export interface ScriptDiagnostic {
  line: number;
  start: number;
  end: number;
  code: DiagnosticCode;
  message: string;
}

export interface LintOptions {
  fullwidthPunctuation?: boolean;
}

type Section = 'IF' | 'ACT' | 'SAY' | null;

const actionCommands = new Set(actionCommandsData.map((c) => c.name.toUpperCase()));
actionCommands.add('#CALL');
const checkCommands = new Set(checkCommandsData.map((c) => c.name.toUpperCase()));
const sysVariables = new Set(sysVariablesData.map((v) => v.name.toUpperCase()));
const sectionRe = /^\s*#\s*(IFONE|IF|ACT|ELSEACT|SAY|ELSESAY)\b/i;
const commandRe = /^\s*!?(#CALL|[A-Za-z][A-Za-z0-9_]*)/i;
const standaloneVariableRe = /^\s*(?:<\$([A-Za-z][A-Za-z0-9_]*)[^>]*>|\$([A-Za-z][A-Za-z0-9_]*)(?:\([^)]*\))?)\s*$/;
const bracketPairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const closingBrackets = new Set(Object.values(bracketPairs));
const fullwidthPunctuation: Record<string, string> = {
  '，': ',', '。': '.', '．': '.', '；': ';', '：': ':', '？': '?', '！': '!',
  '（': '(', '）': ')', '［': '[', '］': ']', '｛': '{', '｝': '}', '【': '[', '】': ']',
  '＜': '<', '＞': '>', '＃': '#', '＠': '@', '＄': '$', '％': '%', '＾': '^', '＆': '&',
  '＊': '*', '＋': '+', '－': '-', '＝': '=', '｜': '|', '＼': '\\', '／': '/', '～': '~',
  '　': ' ',
};
const fullwidthRe = /[，。．；：？！（）［］｛｝【】＜＞＃＠＄％＾＆＊＋－＝｜＼／～　]/g;

function commandRange(line: string, name: string): { start: number; end: number } {
  const start = line.indexOf(name);
  return { start, end: start + name.length };
}

interface BracketLocation {
  bracket: string;
  line: number;
  index: number;
}

function checkBrackets(
  line: string,
  lineNumber: number,
  diagnostics: ScriptDiagnostic[],
  curlyStack: BracketLocation[],
): void {
  const stack: BracketLocation[] = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '{' || char === '}') {
      if (char === '{') curlyStack.push({ bracket: char, line: lineNumber, index: i });
      else if (curlyStack.length) curlyStack.pop();
      else diagnostics.push({
        line: lineNumber, start: i, end: i + 1, code: 'unmatched-bracket',
        message: '多余的右括号“}”，缺少对应的左括号',
      });
      continue;
    }
    if (bracketPairs[char]) {
      stack.push({ bracket: char, line: lineNumber, index: i });
      continue;
    }
    if (!closingBrackets.has(char)) continue;
    const open = stack[stack.length - 1];
    if (!open) {
      diagnostics.push({
        line: lineNumber, start: i, end: i + 1, code: 'unmatched-bracket',
        message: `多余的右括号“${char}”，缺少对应的左括号`,
      });
      continue;
    }
    if (bracketPairs[open.bracket] !== char) {
      diagnostics.push({
        line: lineNumber, start: i, end: i + 1, code: 'unmatched-bracket',
        message: `括号不匹配：“${open.bracket}”应使用“${bracketPairs[open.bracket]}”闭合，而不是“${char}”`,
      });
      stack.pop();
      continue;
    }
    stack.pop();
  }
  for (const open of stack) {
    diagnostics.push({
      line: lineNumber, start: open.index, end: open.index + 1, code: 'unclosed-bracket',
      message: `缺少右括号“${bracketPairs[open.bracket]}”，请与“${open.bracket}”配对`,
    });
  }
}

export function lintScript(text: string, options: LintOptions = {}): ScriptDiagnostic[] {
  const diagnostics: ScriptDiagnostic[] = [];
  const lines = text.split(/\r?\n/);
  const curlyStack: BracketLocation[] = [];
  const checkFullwidth = options.fullwidthPunctuation !== false;
  let section: Section = null;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const raw = lines[lineNumber];
    if (/^\s*(;|\/\/)/.test(raw)) continue;
    const line = stripComment(raw);
    if (!line.trim()) continue;

    const sectionMatch = line.match(sectionRe);
    if (sectionMatch) {
      const marker = sectionMatch[1].toUpperCase();
      section = marker === 'IF' || marker === 'IFONE' ? 'IF'
        : marker === 'ACT' || marker === 'ELSEACT' ? 'ACT' : 'SAY';
    } else if (/^\s*\[@[^\]]+\]/.test(line)) {
      section = null;
    }

    const structuralCurly = /^\s*[{}]\s*$/.test(line);
    if (section !== 'SAY' || structuralCurly) {
      if (section !== 'SAY' && checkFullwidth) {
        for (const match of line.matchAll(fullwidthRe)) {
          const char = match[0];
          const start = match.index!;
          diagnostics.push({
            line: lineNumber, start, end: start + char.length, code: 'fullwidth-punctuation',
            message: `使用了全角标点“${char === '　' ? '全角空格' : char}”，请改为半角“${fullwidthPunctuation[char]}”`,
          });
        }
      }
      checkBrackets(line, lineNumber, diagnostics, curlyStack);
    }

    const standaloneVariable = line.match(standaloneVariableRe);
    const variableName = standaloneVariable?.[1] || standaloneVariable?.[2];
    if (section !== 'SAY' && variableName && sysVariables.has(variableName.toUpperCase())) {
      const start = line.search(/\S/);
      diagnostics.push({
        line: lineNumber, start, end: line.trimEnd().length, code: 'standalone-variable',
        message: `变量表达式“${line.trim()}”不能单独作为命令，请放入检测或执行命令的参数中`,
      });
    }

    const commandMatch = line.match(commandRe);
    if (!commandMatch) continue;
    const command = commandMatch[1];
    const upper = command.toUpperCase();
    const range = commandRange(line, command);
    const isAction = actionCommands.has(upper);
    const isCheck = checkCommands.has(upper);
    if (section === 'IF' && isAction && !isCheck) {
      diagnostics.push({
        line: lineNumber, ...range, code: 'action-in-if',
        message: `执行命令“${command}”不能写在 #IF 段，请移到 #ACT 或 #ELSEACT 段`,
      });
    } else if (section === 'ACT' && isCheck && !isAction) {
      diagnostics.push({
        line: lineNumber, ...range, code: 'check-in-act',
        message: `检测命令“${command}”不能写在 #ACT 段，请移到 #IF 或 #IFONE 段`,
      });
    } else if (section === 'SAY' && (isAction || isCheck)) {
      const target = isAction && !isCheck ? '#ACT 或 #ELSEACT'
        : isCheck && !isAction ? '#IF 或 #IFONE' : '#IF 或 #ACT';
      diagnostics.push({
        line: lineNumber, ...range, code: 'command-in-say',
        message: `#SAY/#ELSESAY 段只能写对话文本，命令“${command}”请移到 ${target} 段`,
      });
    } else if (section === null && (isAction || isCheck) && upper !== '#CALL') {
      const message = isAction && !isCheck
        ? `执行命令“${command}”必须放在 #ACT 或 #ELSEACT 段中`
        : isCheck && !isAction
          ? `检测命令“${command}”必须放在 #IF 或 #IFONE 段中`
          : `命令“${command}”必须放在 #IF 或 #ACT 段中`;
      diagnostics.push({ line: lineNumber, ...range, code: 'command-outside-section', message });
    }
  }
  for (const open of curlyStack) {
    diagnostics.push({
      line: open.line, start: open.index, end: open.index + 1, code: 'unclosed-bracket',
      message: '缺少右括号“}”，请与“{”配对',
    });
  }
  return diagnostics;
}
