import { stripComment } from '../scanner/scanCore';

export type LineKind = 'label' | 'section' | 'command' | 'saytext' | 'blank';
export type SectionKind = 'IF' | 'IFONE' | 'ACT' | 'ELSEACT' | 'SAY' | 'ELSESAY';

export interface ScriptLine {
  index: number;      // 0 基
  raw: string;
  text: string;       // 去注释后
  kind: LineKind;
  label?: string;     // label 行: 标签名(不含@)
  section?: SectionKind;
}

export interface Script {
  file: string;                    // 调用方给的文件标识(一般为绝对路径)
  lines: ScriptLine[];
  labels: Map<string, number>;     // 标签名(小写, 不含@) -> 行号
  forToEnd: Map<number, number>;   // FOR 行 -> ENDFOR 行
  endToFor: Map<number, number>;   // ENDFOR 行 -> FOR 行
}

const LABEL_RE = /^\s*\[@([^\]]+)\]/;
const SECTION_RE = /^\s*#(IFONE|IF|ACT|ELSEACT|ELSESAY|SAY)\b/i;
const FOR_RE = /^\s*FOR\b/i;
const ENDFOR_RE = /^\s*ENDFOR\b/i;

export function parseScript(file: string, text: string): Script {
  const rawLines = text.split(/\r?\n/);
  const lines: ScriptLine[] = [];
  const labels = new Map<string, number>();
  let inSay = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const stripped = stripComment(raw);
    const t = stripped.trim();

    const lm = stripped.match(LABEL_RE);
    if (lm) {
      labels.set(lm[1].toLowerCase(), i);
      lines.push({ index: i, raw, text: stripped, kind: 'label', label: lm[1] });
      inSay = false;
      continue;
    }
    const sm = stripped.match(SECTION_RE);
    if (sm) {
      const section = sm[1].toUpperCase() as SectionKind;
      lines.push({ index: i, raw, text: stripped, kind: 'section', section });
      inSay = section === 'SAY' || section === 'ELSESAY';
      continue;
    }
    if (!t) {
      lines.push({ index: i, raw, text: stripped, kind: 'blank' });
      continue;
    }
    lines.push({ index: i, raw, text: stripped, kind: inSay ? 'saytext' : 'command' });
  }

  // FOR/ENDFOR 配对
  const forToEnd = new Map<number, number>();
  const endToFor = new Map<number, number>();
  const stack: number[] = [];
  for (const l of lines) {
    if (l.kind !== 'command') continue;
    if (FOR_RE.test(l.text)) stack.push(l.index);
    else if (ENDFOR_RE.test(l.text) && stack.length) {
      const f = stack.pop()!;
      forToEnd.set(f, l.index);
      endToFor.set(l.index, f);
    }
  }
  return { file, lines, labels, forToEnd, endToFor };
}

/** 该行是否可作为断点/单步停留点 */
export function isExecutable(l: ScriptLine): boolean {
  return l.kind === 'label' || l.kind === 'section' || l.kind === 'command';
}
