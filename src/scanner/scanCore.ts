import varTypesData from '../data/varTypes.json';

export interface VarRef {
  file: string;       // 工作区相对路径
  absPath: string;
  line: number;       // 0 基
  access: 'read' | 'write';
  context: string;    // 该行文本(截断)
}

export interface ScanResult {
  scannedAt: number;
  fileCount: number;
  /** group(变量类型前缀/MARK/CUSTOM) -> 变量名 -> 引用列表 */
  groups: Record<string, Record<string, VarRef[]>>;
}

export type ScanGroups = Record<string, Record<string, VarRef[]>>;

const varTypes = (varTypesData as { varTypes: { prefix: string; min: number; max: number }[] }).varTypes;

/** 这些命令的第一个变量参数为"写"操作 */
const FIRST_ARG_WRITE = new Set([
  'MOV', 'MOVR', 'INC', 'DEC', 'MULT', 'DIV', 'MOD', 'CEIL', 'FLOOR',
  'PERCENT', 'PERMILL', 'TENTHOUSANDTH', 'INSERT', 'TRIM', 'NUMTOCHR',
  'CHANGECUSTOMVALUE', 'FORMATSTR', 'GETVALIDSTR', 'READRANDOMSTR',
]);
/** 这些命令命中的所有变量均为"写"操作 */
const ALL_VARS_WRITE = new Set(['CLEARVAR', 'RESET', 'CLEARHUMCUSTVAR', 'CLEARGLOBALCUSTVAR', 'CLEARGUILDCUSTVAR']);

const TYPED_VAR_RE = /\b([ASPDGIMUTJZ])(\d{1,3})\b/gi;
const MARK_RE = /\[(\d{1,3})\]/g;
const CUSTOM_SHOW_RE = /<\$(?:HUMAN|GUILD|GLOBAL)\(([^)\s]+)\)>/gi;
const VAR_DECL_RE = /^\s*VAR\s+(?:Integer|String)\s+(Global|Guild|Human)\s+(\S+)/i;
const CUSTOM_OP_RE = /^\s*(?:CALCVAR|CHECKVAR|SAVEVAR)\s+(Global|Guild|Human)\s+(\S+)/i;
// CustomValue 变量(0-99): ChangeCustomValue 编号 +/-= 值 为写, <$CUSTOMVALUE(编号)> 为读
const CV_WRITE_RE = /^\s*CHANGECUSTOMVALUE\s+(\d{1,3})\b/i;
const CV_READ_RE = /\$CUSTOMVALUE\(\s*(\d{1,3})\s*\)/gi;

const ENGINE_PATH_RE = /(QuestDiary|Market_def|Npc_def|MapQuest_def|Robot_def|Funtion_def)[\\/]/i;
const ENGINE_FILE_RE = /^(QFunction-.*|QManage.*|QWolShop-.*|RobotManage|AutoRunRobot)\.txt$/i;

export function isEngineScriptPath(fsPath: string): boolean {
  const norm = fsPath.replace(/\//g, '\\');
  if (ENGINE_PATH_RE.test(norm)) return true;
  const base = norm.split('\\').pop() || '';
  return ENGINE_FILE_RE.test(base);
}

/** 去掉行内注释(// 需前面是空白; ; 注释多为行首) */
export function stripComment(line: string): string {
  const semi = line.indexOf(';');
  if (semi === 0) return '';
  const sl = line.search(/(\s)\/\//);
  if (sl >= 0) return line.slice(0, sl);
  return line;
}

export function scanText(text: string, relFile: string, absPath: string): ScanGroups {
  const groups: ScanGroups = {};
  const push = (group: string, name: string, ref: VarRef) => {
    (groups[group] ??= {});
    (groups[group][name] ??= []).push(ref);
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const context = raw.trim().slice(0, 80);
    const cmdMatch = line.match(/^\s*!?([A-Za-z][A-Za-z0-9_]*)/);
    const cmd = cmdMatch ? cmdMatch[1].toUpperCase() : '';
    const cmdEnd = cmdMatch ? line.indexOf(cmdMatch[1]) + cmdMatch[1].length : 0;

    // 自定义变量声明 / 操作
    const decl = line.match(VAR_DECL_RE);
    if (decl) {
      push('CUSTOM', decl[2], { file: relFile, absPath, line: i, access: 'write', context });
    }
    const cop = line.match(CUSTOM_OP_RE);
    if (cop) {
      push('CUSTOM', cop[2], { file: relFile, absPath, line: i, access: cmd === 'CALCVAR' ? 'write' : 'read', context });
    }
    for (const m of line.matchAll(CUSTOM_SHOW_RE)) {
      push('CUSTOM', m[1], { file: relFile, absPath, line: i, access: 'read', context });
    }

    // CustomValue 变量 CV0-CV99
    const cvw = line.match(CV_WRITE_RE);
    if (cvw && parseInt(cvw[1], 10) <= 99) {
      push('CV', `CV${parseInt(cvw[1], 10)}`, { file: relFile, absPath, line: i, access: 'write', context });
    }
    for (const m of line.matchAll(CV_READ_RE)) {
      if (parseInt(m[1], 10) > 99) continue;
      push('CV', `CV${parseInt(m[1], 10)}`, { file: relFile, absPath, line: i, access: 'read', context });
    }

    // 类型变量 A0/S1/...
    let writeFirstArgDone = false;
    for (const m of line.matchAll(TYPED_VAR_RE)) {
      const prefix = m[1].toUpperCase();
      const name = `${prefix}${m[2]}`;
      const vt = varTypes.find((v) => v.prefix === prefix);
      if (vt && parseInt(m[2], 10) > vt.max) continue; // 超出范围视为普通文本
      let access: 'read' | 'write' = 'read';
      if (ALL_VARS_WRITE.has(cmd)) access = 'write';
      else if (FIRST_ARG_WRITE.has(cmd) && !writeFirstArgDone && m.index! >= cmdEnd) {
        access = 'write';
        writeFirstArgDone = true;
      }
      push(prefix, name, { file: relFile, absPath, line: i, access, context });
    }

    // 个人标记 [n] (排除 [@标签])
    if (!/^\s*\[@[^\]]*\]/.test(line)) {
      for (const m of line.matchAll(MARK_RE)) {
        const name = `[${m[1]}]`;
        const access: 'read' | 'write' = (cmd === 'SET' || cmd === 'RESET' || ALL_VARS_WRITE.has(cmd)) ? 'write' : 'read';
        push('MARK', name, { file: relFile, absPath, line: i, access, context });
      }
    }
  }
  return groups;
}

export function mergeGroups(target: ScanGroups, src: ScanGroups): void {
  for (const [g, vars] of Object.entries(src)) {
    for (const [name, refs] of Object.entries(vars)) {
      ((target[g] ??= {})[name] ??= []).push(...refs);
    }
  }
}

export function sortGroups(groups: ScanGroups): void {
  for (const vars of Object.values(groups)) {
    const sorted = Object.fromEntries(
      Object.entries(vars).sort(([a], [b]) => {
        const na = parseInt(a.replace(/\D/g, ''), 10);
        const nb = parseInt(b.replace(/\D/g, ''), 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.localeCompare(b);
      }),
    );
    for (const k of Object.keys(vars)) delete vars[k];
    Object.assign(vars, sorted);
  }
}

/**
 * 996M2 脚本文件为 GBK 编码。有 UTF-8 BOM 或能严格按 UTF-8 解码的按 UTF-8 处理
 * (兼容插件自身生成的文件), 否则按 GBK 解码。
 */
export function decodeScript(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
