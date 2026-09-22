import { Script, ScriptLine, parseScript, isExecutable } from './scriptModel';
import varTypesData from '../data/varTypes.json';

export interface AskProvider {
  /** 无法模拟的检测命令: 询问用户条件是否通过 */
  askCheck(expr: string): Promise<boolean>;
  /** 游戏状态变量/函数求值; prev 为会话内缓存的上次输入 */
  askValue(expr: string, prev?: string): Promise<string>;
}

export interface LoadedFile {
  fileKey: string;   // 断点匹配用的文件标识(一般为规范化绝对路径)
  text: string;
}

export interface InterpreterOptions {
  entryFile: string;
  entryText: string;
  loadFile: (relPath: string, fromFile: string) => Promise<LoadedFile | undefined>;
  loadCsv?: (name: string, fromFile: string) => Promise<string | undefined>;
  ask: AskProvider;
  onOutput?: (text: string) => void;
  maxSteps?: number;
}

export type StopReason = 'entry' | 'breakpoint' | 'step' | 'pause' | 'maxSteps';
export type RunMode = 'entry' | 'continue' | 'next' | 'stepIn' | 'stepOut';

export interface StopInfo {
  file: string;
  line: number;      // 0 基
  reason: StopReason;
}

export interface StackFrameInfo {
  id: number;
  label: string;
  file: string;
  line: number;      // 0 基, 当前等待执行的行
}

interface LoopState {
  label: string;
  labelLine: number;
  remaining: number;
  resumePc: number;   // LoopGoto 下一行
  endLine?: number;   // @标签_END 行
}

interface Segment {
  loop?: LoopState;
  isEnd: boolean;     // 当前处于 @标签_END 段
}

interface Suspended {
  segment: Segment | null;
  resumePc: number;
}

interface PendingIf {
  mode: 'IF' | 'IFONE';
  results: boolean[];
}

interface Frame {
  script: Script;
  pc: number;
  label: string;
  inSegment: boolean;   // 是否已进入某个 [@标签] 段(文件首部注释区不算)
  loops: LoopState[];
  active: Segment | null;
  suspended: Suspended[];
  pendingIf: PendingIf | null;
  forCounts: Map<number, number>;
}

const CALL_RE = /^\s*#CALL\s+\[([^\]]+)\](?:\s+@([^\s;]+))?/i;
const LABEL_ARG_RE = /@([^\s;]+)/;
const NAMED_VAR_RE = /^[A-Za-z]\$[^\s<>$]+$/;
const TYPED_VAR_RE = /^[ASPDGIMUTJZ]\d{1,3}$/i;
const MARK_VAR_RE = /^\[\d{1,3}\]$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;
const FN_RE = /^<\$([A-Za-z][A-Za-z0-9_一-鿿]*)(.*)>$/s;

const PERSONAL_PREFIXES = new Set(
  (varTypesData as { varTypes: { prefix: string; scope: string }[] }).varTypes
    .filter((v) => v.scope.includes('个人') && v.prefix.length === 1)
    .map((v) => v.prefix),
);

export interface VarItem { group: string; name: string; value: string }

export class Interpreter {
  private frames: Frame[] = [];
  private vars = new Map<string, string>();
  private touchedOrder: string[] = [];
  private valueCache = new Map<string, string>();   // 游戏状态模拟值缓存
  private csvCache = new Map<string, string | undefined>();
  private breakpoints = new Map<string, Set<number>>();
  private scripts = new Map<string, Script>();
  private pauseRequested = false;
  private lastStop: StopInfo | null = null;
  private readonly maxSteps: number;
  private readonly ask: AskProvider;
  private readonly loadFile: InterpreterOptions['loadFile'];
  private readonly loadCsv?: InterpreterOptions['loadCsv'];
  private readonly out: (text: string) => void;
  private justArrived = true;

  constructor(opts: InterpreterOptions) {
    this.ask = opts.ask;
    this.loadFile = opts.loadFile;
    this.loadCsv = opts.loadCsv;
    this.out = opts.onOutput ?? (() => {});
    this.maxSteps = opts.maxSteps ?? 100000;
    const script = this.getScript(opts.entryFile, opts.entryText);
    this.frames.push(this.newFrame(script, 0, '主程序'));
  }

  // ---------- 对外接口 ----------

  setBreakpoints(file: string, lines: number[]): void {
    this.breakpoints.set(this.norm(file), new Set(lines));
  }

  /** 调试启动时预设变量值(用于进入依赖游戏状态的分支) */
  presetVars(vars: Record<string, string>): void {
    for (const [k, v] of Object.entries(vars)) this.setVar(k, String(v));
  }

  requestPause(): void {
    this.pauseRequested = true;
  }

  stackTrace(): StackFrameInfo[] {
    return this.frames.map((f, i) => ({ id: i + 1, label: f.label, file: f.script.file, line: Math.min(f.pc, f.script.lines.length - 1) }));
  }

  currentFile(): string {
    return this.frames[this.frames.length - 1]?.script.file ?? '';
  }

  /** 变量快照(只含被读写过的) */
  snapshotVars(): VarItem[] {
    const items: VarItem[] = [];
    for (const key of this.touchedOrder) {
      const v = this.vars.get(key);
      if (v === undefined) continue;
      items.push({ group: this.groupOf(key), name: this.displayName(key), value: v });
    }
    for (const [expr, v] of this.valueCache) {
      items.push({ group: '游戏状态模拟值', name: expr, value: v });
    }
    return items;
  }

  /** Watch/悬停求值: 不弹窗, 未知游戏状态值给占位提示 */
  evaluate(expr: string): string {
    const t = expr.trim();
    try {
      if (NAMED_VAR_RE.test(t) || TYPED_VAR_RE.test(t) || MARK_VAR_RE.test(t)) {
        return this.getVar(t);
      }
      return this.expandTextSync(t);
    } catch (e) {
      return `<求值失败: ${(e as Error).message}>`;
    }
  }

  /**
   * 运行直到停止。返回停止信息; 返回 null 表示脚本执行完毕。
   */
  async run(mode: RunMode): Promise<StopInfo | null> {
    this.pauseRequested = false;
    const startFrames = this.frames.length;
    const startDepth = this.depth();
    let executed = false;
    let firstLine = true;
    let steps = 0;

    while (this.frames.length > 0) {
      if (++steps > this.maxSteps) {
        return this.stop('maxSteps');
      }
      const frame = this.top;
      const lines = frame.script.lines;

      if (frame.pc >= lines.length) {
        this.segmentEnd(frame);
        continue;
      }
      const line = lines[frame.pc];

      // 标签边界: 段内非跳转落入新标签 = 当前段自然结束(文件首部注释区不算段)
      if (line.kind === 'label' && !this.justArrived && frame.inSegment) {
        if (frame.pendingIf) frame.pendingIf = null; // #IF 后无任何分支段
        this.segmentEnd(frame);
        continue;
      }

      if (!isExecutable(line)) {
        frame.pc++;
        this.justArrived = false;
        continue;
      }

      // 停止条件(在执行该行之前)
      const sameAsLastStop = this.lastStop && this.lastStop.file === frame.script.file && this.lastStop.line === frame.pc;
      if (!(firstLine && sameAsLastStop)) {
        if (this.pauseRequested) return this.stop('pause');
        if (mode === 'entry' && !executed) return this.stop('entry');
        if (executed) {
          if (mode === 'stepIn') return this.stop('step');
          if (mode === 'next' && (this.depth() <= startDepth || this.frames.length < startFrames)) return this.stop('step');
          if (mode === 'stepOut' && this.frames.length < startFrames) return this.stop('step');
        }
        if (mode !== 'entry' && this.breakpoints.get(this.norm(frame.script.file))?.has(frame.pc)) {
          return this.stop('breakpoint');
        }
      }
      firstLine = false;

      await this.execLine(frame, line);
      executed = true;
    }
    return null;
  }

  // ---------- 内部: 行执行 ----------

  private async execLine(frame: Frame, line: ScriptLine): Promise<void> {
    frame.inSegment = true;
    switch (line.kind) {
      case 'label':
        this.advance(frame);
        return;
      case 'section':
        return this.execSection(frame, line);
      case 'command':
        return this.execCommand(frame, line);
      default:
        this.advance(frame);
    }
  }

  private async execSection(frame: Frame, line: ScriptLine): Promise<void> {
    const sec = line.section!;
    if (sec === 'IF' || sec === 'IFONE') {
      frame.pendingIf = { mode: sec, results: [] };
      this.advance(frame);
      return;
    }
    if (frame.pendingIf) {
      const pending = frame.pendingIf;
      frame.pendingIf = null;
      const pass = pending.mode === 'IFONE' ? pending.results.some(Boolean) : pending.results.every(Boolean);
      this.out(`${pending.mode === 'IFONE' ? '#IFONE' : '#IF'} 结果: ${pass ? '通过' : '不通过' + '(跳过执行段)'}`);
      if (sec === 'ELSEACT' || sec === 'ELSESAY') {
        // 条件段后直接是 ELSE 段: 通过则本段无事可做
        if (pass) {
          this.segmentEnd(frame);
          return;
        }
      } else if (!pass) {
        // ACT/SAY 但条件不通过: 找 ELSE 段或结束本段
        const j = this.findElseOrBoundary(frame, frame.pc + 1);
        if (j.found) {
          frame.pc = j.index;
          this.justArrived = true;
        } else {
          frame.pc = j.index;
          this.justArrived = false;
        }
        return;
      }
      // 通过则落入下面正常处理
    } else if ((sec === 'ELSEACT' || sec === 'ELSESAY') && !this.justArrived) {
      // ACT 段体执行完落入 ELSE 段: 本段结束
      this.segmentEnd(frame);
      return;
    }
    if (sec === 'SAY' || sec === 'ELSESAY') {
      await this.outputSayBlock(frame);
      return;
    }
    this.advance(frame); // ACT / 进入的 ELSEACT
  }

  private findElseOrBoundary(frame: Frame, from: number): { found: boolean; index: number } {
    const lines = frame.script.lines;
    for (let i = from; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'section' && (l.section === 'ELSEACT' || l.section === 'ELSESAY')) return { found: true, index: i };
      if (l.kind === 'label') return { found: false, index: i };
    }
    return { found: false, index: lines.length };
  }

  private async outputSayBlock(frame: Frame): Promise<void> {
    const lines = frame.script.lines;
    let i = frame.pc + 1;
    while (i < lines.length && lines[i].kind !== 'label' && lines[i].kind !== 'section') {
      const t = lines[i].text.trim();
      if (t) this.out(`对话: ${await this.expandText(t)}`);
      i++;
    }
    frame.pc = i;
    this.justArrived = false;
  }

  private async execCommand(frame: Frame, line: ScriptLine): Promise<void> {
    const text = line.text.trim();
    const cmdMatch = text.match(/^(!?)(#?[A-Za-z][A-Za-z0-9_]*)/);
    if (!cmdMatch) {
      this.advance(frame);
      return;
    }
    const negated = cmdMatch[1] === '!';
    const cmd = cmdMatch[2].toUpperCase();
    const rest = text.slice(cmdMatch[0].length).trim();

    // #IF 段内的命令均为条件检测
    if (frame.pendingIf) {
      const r = await this.evalCondition(cmd, rest, negated, text);
      frame.pendingIf.results.push(r);
      this.out(`条件检测: ${text} => ${r ? '通过' : '不通过'}`);
      this.advance(frame);
      return;
    }

    switch (cmd) {
      case 'MOV': {
        const sp = rest.search(/\s/);
        if (sp < 0) break;
        this.setVar(rest.slice(0, sp), await this.evalValue(rest.slice(sp + 1).trim()));
        break;
      }
      case 'INC':
      case 'DEC': {
        // 值取变量名后的整行剩余内容(字符串值可能含空格, 如 color= 255);
        // 字符串变量上 INC 为拼接(引擎常用其拼接 UI 字符串), 两边都是数字才按数值加减
        const sp = rest.search(/\s/);
        const varName = sp < 0 ? rest : rest.slice(0, sp);
        if (!varName) break;
        const cur = this.getVar(varName);
        const operand = sp < 0 ? '1' : await this.evalValue(rest.slice(sp + 1).trim());
        if (NUM_RE.test(cur) && NUM_RE.test(operand)) {
          this.setVar(varName, String(this.toNum(cur) + (cmd === 'INC' ? 1 : -1) * this.toNum(operand)));
        } else if (cmd === 'INC') {
          this.setVar(varName, cur + operand);
        } else {
          this.setVar(varName, String(this.toNum(cur) - this.toNum(operand)));
        }
        break;
      }
      case 'MULT':
      case 'DIV':
      case 'MOD': {
        const parts = rest.split(/\s+/);
        if (!parts[0]) break;
        const cur = this.toNum(this.getVar(parts[0]));
        const operand = parts[1] !== undefined ? this.toNum(await this.evalValue(parts[1])) : 1;
        let v = cur;
        if (cmd === 'MULT') v = cur * operand;
        else if (cmd === 'DIV') v = operand === 0 ? cur : Math.floor(cur / operand);
        else v = operand === 0 ? cur : cur % operand;
        this.setVar(parts[0], String(v));
        break;
      }
      case 'MOVR': {
        const parts = rest.split(/\s+/);
        if (!parts[0]) break;
        let min = 0;
        let max = this.toNum(await this.evalValue(parts[1] ?? '0'));
        if (parts[2] !== undefined) {
          min = max;
          max = this.toNum(await this.evalValue(parts[2]));
        }
        const v = max <= min ? min : min + Math.floor(Math.random() * (max - min + 1));
        this.setVar(parts[0], String(v));
        break;
      }
      case 'VAR': {
        const m = rest.match(/^(Integer|String)\s+(Global|Guild|Human)\s+(\S+)/i);
        if (m) this.setVar(`${m[2].toUpperCase()}:${m[3]}`, m[1].toLowerCase() === 'integer' ? '0' : '');
        break;
      }
      case 'CALCVAR': {
        const m = rest.match(/^(Global|Guild|Human)\s+(\S+)\s*(=|\+|-|\*)\s*(.*)$/i);
        if (m) {
          const key = `${m[1].toUpperCase()}:${m[2]}`;
          const val = await this.evalValue(m[4].trim());
          this.applyOp(key, m[3], val);
        }
        break;
      }
      case 'SAVEVAR':
        break; // 持久化, 模拟器无需处理
      case 'CLEARVAR': {
        const m = rest.match(/^([A-Za-z])(\d{1,3})\s+(\d+)/);
        if (m) {
          const start = parseInt(m[2], 10);
          const count = parseInt(m[3], 10);
          for (let i = start; i < start + count; i++) this.setVar(`${m[1].toUpperCase()}${i}`, '0');
        }
        break;
      }
      case 'CLEARHUMCUSTVAR':
      case 'CLEARGLOBALCUSTVAR':
      case 'CLEARGUILDCUSTVAR': {
        const scope = cmd === 'CLEARHUMCUSTVAR' ? 'HUMAN:' : cmd === 'CLEARGUILDCUSTVAR' ? 'GUILD:' : 'GLOBAL:';
        for (const k of [...this.vars.keys()]) if (k.startsWith(scope)) this.vars.set(k, '');
        break;
      }
      case 'SET': {
        const m = rest.match(/^\[(\d{1,3})\]\s+(\d)/);
        if (m) this.setVar(`[${m[1]}]`, m[2] === '0' ? '0' : '1');
        break;
      }
      case 'RESET': {
        const parts = rest.split(/\s+/);
        const start = this.toNum(await this.evalValue(parts[0] ?? '0'));
        const count = this.toNum(await this.evalValue(parts[1] ?? '0'));
        for (let i = start; i < start + count; i++) this.setVar(`[${i}]`, '0');
        break;
      }
      case 'CHANGECUSTOMVALUE': {
        const m = rest.match(/^(\d{1,3})\s*(=|\+|-)\s*(.*)$/);
        if (m) this.applyOp(`CV${parseInt(m[1], 10)}`, m[2], await this.evalValue(m[3].trim()));
        break;
      }
      case 'GOTO': {
        const lm = rest.match(LABEL_ARG_RE);
        if (lm && this.jumpToLabel(frame, lm[1])) return;
        this.out(`警告: GOTO 目标标签不存在 @${lm?.[1] ?? rest}`);
        break;
      }
      case '#CALL': {
        const m = line.text.match(CALL_RE);
        if (!m) break;
        const loaded = await this.loadFile(m[1], frame.script.file);
        if (!loaded) {
          this.out(`警告: #CALL 文件不存在 [${m[1]}]`);
          break;
        }
        const script = this.getScript(loaded.fileKey, loaded.text);
        let startLine = 0;
        let label = script.file;
        if (m[2]) {
          const li = script.labels.get(m[2].toLowerCase());
          if (li === undefined) {
            this.out(`警告: #CALL 目标标签不存在 @${m[2]}`);
            break;
          }
          startLine = li;
          label = `@${m[2]}`;
        }
        frame.pc++; // 返回点 = #CALL 下一行
        this.frames.push(this.newFrame(script, startLine, label));
        this.justArrived = true;
        return;
      }
      case 'LOOPGOTO': {
        const parts = rest.split(/\s+/);
        const label = (parts[0] ?? '').replace(/^@/, '');
        const count = Math.max(1, Math.min(9999, this.toNum(await this.evalValue(parts[1] ?? '1'))));
        const labelLine = frame.script.labels.get(label.toLowerCase());
        if (labelLine === undefined) {
          this.out(`警告: LOOPGOTO 目标标签不存在 @${label}`);
          break;
        }
        const endLine = frame.script.labels.get(`${label.toLowerCase()}_end`);
        frame.suspended.push({ segment: frame.active, resumePc: frame.pc + 1 });
        const loop: LoopState = { label, labelLine, remaining: count, resumePc: frame.pc + 1, endLine };
        frame.loops.push(loop);
        frame.active = { loop, isEnd: false };
        frame.pc = labelLine;
        this.justArrived = true;
        return;
      }
      case 'STOP': {
        if (frame.active?.loop && !frame.active.isEnd) {
          const loop = frame.active.loop;
          frame.loops.pop();
          if (loop.endLine !== undefined) {
            frame.active = { loop, isEnd: true };
            frame.pc = loop.endLine;
            this.justArrived = true;
          } else {
            this.resumeSuspended(frame);
          }
        } else {
          this.popFrame();
        }
        return;
      }
      case 'BREAK': {
        if (frame.active?.loop && !frame.active.isEnd) {
          frame.loops.pop();
          this.resumeSuspended(frame);
        } else {
          this.popFrame();
        }
        return;
      }
      case 'FOR': {
        const endLine = frame.script.forToEnd.get(frame.pc);
        if (endLine === undefined) break;
        const cond = await this.evalForCondition(rest);
        if (cond) {
          frame.pc = endLine + 1; // 条件达成, 退出循环
          frame.forCounts.delete(frame.pc);
          this.justArrived = false;
          return;
        }
        break; // 进入循环体
      }
      case 'ENDFOR': {
        const forLine = frame.script.endToFor.get(frame.pc);
        if (forLine === undefined) break;
        const n = (frame.forCounts.get(forLine) ?? 0) + 1;
        frame.forCounts.set(forLine, n);
        if (n >= 10000) {
          this.out('警告: FOR 循环达到 10000 次上限, 强制退出');
          break;
        }
        frame.pc = forLine;
        this.justArrived = true;
        return;
      }
      case 'DELAYCALL':
      case 'DELAYGOTO': {
        const parts = rest.split(/\s+/);
        if (cmd === 'DELAYCALL' && parts[0] === '0') break; // 清除定时器
        const lm = rest.match(LABEL_ARG_RE);
        if (lm && frame.script.labels.has(lm[1].toLowerCase())) {
          this.out(`提示: ${cmd} ${lm[0]} 为延时调用, 调试中立即执行`);
          const labelLine = frame.script.labels.get(lm[1].toLowerCase())!;
          frame.pc++;
          this.frames.push(this.newFrame(frame.script, labelLine, `@${lm[1]}(延时)`));
          this.justArrived = true;
          return;
        }
        this.out(`警告: ${cmd} 目标标签不存在 ${lm?.[0] ?? rest}`);
        break;
      }
      case 'SENDMSG':
      case 'MESSAGEBOX':
      case 'DEBUGLOG': {
        const sp = rest.search(/\s/);
        const msg = sp < 0 ? rest : rest.slice(sp + 1);
        this.out(`${cmd}: ${await this.expandText(msg)}`);
        break;
      }
      case 'STARTTIMER':
      case 'STOPTIMER': {
        if (cmd === 'STOPTIMER') {
          const parts = rest.split(/\s+/);
          if (parts[1] && TYPED_VAR_RE.test(parts[1])) this.setVar(parts[1], '0');
        }
        break;
      }
      default:
        this.out(`已跳过(副作用命令): ${text}`);
        break;
    }
    this.advance(frame);
  }

  // ---------- 内部: 段/帧/循环 ----------

  private segmentEnd(frame: Frame): void {
    const s = frame.active;
    if (s?.loop && !s.isEnd) {
      const loop = s.loop;
      loop.remaining--;
      if (loop.remaining > 0) {
        frame.pc = loop.labelLine;
        this.justArrived = true;
        frame.inSegment = false;
        return;
      }
      frame.loops.pop();
      if (loop.endLine !== undefined) {
        frame.active = { loop, isEnd: true };
        frame.pc = loop.endLine;
        this.justArrived = true;
        frame.inSegment = false;
        return;
      }
      this.resumeSuspended(frame);
      return;
    }
    if (s?.isEnd) {
      this.resumeSuspended(frame);
      return;
    }
    this.popFrame();
  }

  private resumeSuspended(frame: Frame): void {
    const susp = frame.suspended.pop();
    frame.active = susp?.segment ?? null;
    frame.pc = susp?.resumePc ?? frame.script.lines.length;
    this.justArrived = false;
    frame.inSegment = true; // 回到被 LoopGoto 暂停的外层段中继续
  }

  private popFrame(): void {
    this.frames.pop();
    this.justArrived = false;
  }

  private jumpToLabel(frame: Frame, label: string): boolean {
    const li = frame.script.labels.get(label.toLowerCase());
    if (li === undefined) return false;
    frame.pendingIf = null;
    frame.pc = li;
    this.justArrived = true;
    return true;
  }

  private newFrame(script: Script, pc: number, label: string): Frame {
    return { script, pc, label, inSegment: false, loops: [], active: null, suspended: [], pendingIf: null, forCounts: new Map() };
  }

  private getScript(fileKey: string, text: string): Script {
    let s = this.scripts.get(fileKey);
    if (!s) {
      s = parseScript(fileKey, text);
      this.scripts.set(fileKey, s);
    }
    return s;
  }

  private advance(frame: Frame): void {
    frame.pc++;
    this.justArrived = false;
  }

  private stop(reason: StopReason): StopInfo {
    const frame = this.top;
    const info: StopInfo = { file: frame.script.file, line: frame.pc, reason };
    this.lastStop = info;
    return info;
  }

  private get top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private depth(): number {
    let d = 0;
    for (const f of this.frames) d += 1 + f.suspended.length;
    return d;
  }

  private norm(p: string): string {
    return p.replace(/\//g, '\\').toLowerCase();
  }

  // ---------- 内部: 条件与求值 ----------

  private async evalCondition(cmd: string, rest: string, negated: boolean, fullText: string): Promise<boolean> {
    let r: boolean;
    const parts = rest.split(/\s+/);
    switch (cmd) {
      case 'TRUE':
        r = true;
        break;
      case 'FALSE':
        r = false;
        break;
      case 'EQUAL': {
        const a = await this.evalValue(parts[0] ?? '');
        const b = await this.evalValue(rest.slice(parts[0]?.length ?? 0).trim());
        r = NUM_RE.test(a) && NUM_RE.test(b) ? this.toNum(a) === this.toNum(b) : a === b;
        break;
      }
      case 'LARGE':
        r = this.toNum(await this.evalValue(parts[0] ?? '0')) > this.toNum(await this.evalValue(parts[1] ?? '0'));
        break;
      case 'SMALL':
        r = this.toNum(await this.evalValue(parts[0] ?? '0')) < this.toNum(await this.evalValue(parts[1] ?? '0'));
        break;
      case 'CHECK': {
        const m = rest.match(/^\[(\d{1,3})\]\s+(\d)/);
        r = m ? this.getVar(`[${m[1]}]`) === m[2] : await this.ask.askCheck(fullText);
        break;
      }
      case 'CHECKVAR': {
        const m = rest.match(/^(Global|Guild|Human)\s+(\S+)\s*(=|>|<|!)\s*(.*)$/i);
        if (m) {
          const cur = this.getVar(`${m[1].toUpperCase()}:${m[2]}`);
          const val = await this.evalValue(m[4].trim());
          r = this.compare(cur, m[3], val);
        } else {
          r = await this.ask.askCheck(fullText);
        }
        break;
      }
      default:
        r = await this.ask.askCheck(fullText);
        break;
    }
    return negated ? !r : r;
  }

  private async evalForCondition(rest: string): Promise<boolean> {
    const m = rest.match(/^(\S+)\s*(>=|<=|>|<|=|!)\s*(\S+)$/);
    if (!m) return true; // 无法解析视为达成, 避免死循环
    const a = await this.evalValue(m[1]);
    const b = await this.evalValue(m[3]);
    return this.compare(a, m[2], b);
  }

  private compare(a: string, op: string, b: string): boolean {
    const na = this.toNum(a);
    const nb = this.toNum(b);
    switch (op) {
      case '=': return NUM_RE.test(a) && NUM_RE.test(b) ? na === nb : a === b;
      case '>': return na > nb;
      case '<': return na < nb;
      case '>=': return na >= nb;
      case '<=': return na <= nb;
      case '!': return NUM_RE.test(a) && NUM_RE.test(b) ? na !== nb : a !== b;
      default: return false;
    }
  }

  private applyOp(key: string, op: string, val: string): void {
    const cur = this.getVar(key);
    if (op === '=') {
      this.setVar(key, val);
      return;
    }
    if (op === '+' && (!NUM_RE.test(cur) || !NUM_RE.test(val))) {
      this.setVar(key, cur + val); // 文本相加
      return;
    }
    const c = this.toNum(cur);
    const v = this.toNum(val);
    const r = op === '+' ? c + v : op === '-' ? c - v : op === '*' ? c * v : c;
    this.setVar(key, String(r));
  }

  /** 求值单个token: 变量/函数/数字/字符串 */
  private async evalValue(token: string): Promise<string> {
    const t = token.trim();
    if (!t) return '';
    if (t.startsWith('<$')) {
      return this.evalFunction(t, (expr) => this.askValueAsync(expr));
    }
    if (NAMED_VAR_RE.test(t) || TYPED_VAR_RE.test(t) || MARK_VAR_RE.test(t)) {
      return this.getVar(t);
    }
    return t;
  }

  private async askValueAsync(expr: string): Promise<string> {
    const cached = this.valueCache.get(expr);
    if (cached !== undefined) return cached;
    const v = await this.ask.askValue(expr, undefined);
    this.valueCache.set(expr, v);
    return v;
  }

  /** 展开文本中所有 <$...> 表达式(异步, 未知值弹窗) */
  private async expandText(text: string): Promise<string> {
    const spans = this.findFnSpans(text);
    if (!spans.length) return text;
    let out = '';
    let pos = 0;
    for (const [s, e] of spans) {
      out += text.slice(pos, s);
      out += await this.evalFunction(text.slice(s, e), (expr) => this.askValueAsync(expr));
      pos = e;
    }
    return out + text.slice(pos);
  }

  /** 同步展开(对话预览/Watch): 未知游戏状态值用缓存或占位符, 不弹窗 */
  private expandTextSync(text: string): string {
    const spans = this.findFnSpans(text);
    if (!spans.length) return text;
    let out = '';
    let pos = 0;
    for (const [s, e] of spans) {
      const expr = text.slice(s, e);
      out += text.slice(pos, s);
      out += this.evalFunctionSync(expr);
      pos = e;
    }
    return out + text.slice(pos);
  }

  private evalFunctionSync(expr: string): string {
    const cached = this.valueCache.get(expr);
    // 尝试本地求值: 变量/STR/加减等不需要询问的场景
    const local = this.tryEvalLocal(expr);
    if (local !== undefined) return local;
    return cached ?? `<游戏状态:${expr}>`;
  }

  /** 尝试不询问的本地求值; 需要游戏状态返回 undefined */
  private tryEvalLocal(expr: string): string | undefined {
    const m = expr.match(FN_RE);
    if (!m) return undefined;
    const name = m[1].toUpperCase();
    const inner = m[2];
    if (name === 'STR' && inner.startsWith('(')) {
      const arg = inner.slice(1).replace(/\)$/, '');
      return this.evalTokenLocal(arg.trim());
    }
    if ((name === 'DEC' || name === 'INC') && inner.startsWith('^')) {
      const parts = this.splitTopLevel(inner.slice(1), '^');
      if (parts.length === 2) {
        const a = this.evalTokenLocal(parts[0]);
        const b = this.evalTokenLocal(parts[1]);
        if (a !== undefined && b !== undefined) {
          return String(name === 'DEC' ? this.toNum(a) - this.toNum(b) : this.toNum(a) + this.toNum(b));
        }
      }
      return undefined;
    }
    if (name === 'CUSTOMVALUE' && inner.startsWith('(')) {
      const n = parseInt(inner.slice(1), 10);
      if (!isNaN(n)) return this.getVar(`CV${n}`);
      return undefined;
    }
    if (name === 'HUMAN' || name === 'GUILD' || name === 'GLOBAL') {
      if (inner.startsWith('(')) return this.getVar(`${name}:${inner.slice(1).replace(/\)$/, '').trim()}`);
      return undefined;
    }
    return undefined;
  }

  private evalTokenLocal(t: string): string | undefined {
    if (!t) return '';
    if (t.startsWith('<$')) return this.tryEvalLocal(t);
    if (NAMED_VAR_RE.test(t) || TYPED_VAR_RE.test(t) || MARK_VAR_RE.test(t)) {
      return this.getVar(t);
    }
    return t;
  }

  /** 求值 <$...> 函数表达式(异步版, 可弹窗) */
  private async evalFunction(expr: string, askFn: (e: string) => Promise<string>): Promise<string> {
    const m = expr.match(FN_RE);
    if (!m) return askFn(expr);
    const name = m[1].toUpperCase();
    const inner = m[2];
    const parenArg = () => inner.slice(1).replace(/\)$/, '');

    if (name === 'STR' && inner.startsWith('(')) {
      return this.evalValue(parenArg().trim());
    }
    if ((name === 'DEC' || name === 'INC') && inner.startsWith('^')) {
      const parts = this.splitTopLevel(inner.slice(1), '^');
      if (parts.length === 2) {
        const a = this.toNum(await this.evalValue(parts[0]));
        const b = this.toNum(await this.evalValue(parts[1]));
        return String(name === 'DEC' ? a - b : a + b);
      }
      return askFn(expr);
    }
    if (name === 'CUSTOMVALUE' && inner.startsWith('(')) {
      const n = parseInt(parenArg(), 10);
      return isNaN(n) ? askFn(expr) : this.getVar(`CV${n}`);
    }
    if (name === 'HUMAN' || name === 'GUILD' || name === 'GLOBAL') {
      if (inner.startsWith('(')) return this.getVar(`${name}:${parenArg().trim()}`);
      return askFn(expr);
    }
    if (name.startsWith('CFG_') && inner.startsWith('(')) {
      const cfgName = m[1].slice(4);
      const argText = parenArg();
      const rc = this.splitTopLevel(argText, '_');
      const rowV = await this.evalValue(rc[0] ?? '');
      const colV = await this.evalValue(rc[1] ?? '');
      if (NUM_RE.test(rowV) && NUM_RE.test(colV) && this.loadCsv) {
        const csv = await this.getCsv(cfgName, this.top.script.file);
        if (csv !== undefined) {
          const row = csv.split(/\r?\n/)[parseInt(rowV, 10)] ?? '';
          const cell = row.split(',')[parseInt(colV, 10)] ?? '';
          return cell.trim();
        }
      }
      return askFn(expr);
    }
    // 内置变量/未知函数: 游戏状态, 询问(带缓存)
    return askFn(expr);
  }

  private async getCsv(name: string, fromFile: string): Promise<string | undefined> {
    const key = name.toLowerCase();
    if (!this.csvCache.has(key)) {
      this.csvCache.set(key, await this.loadCsv!(name, fromFile));
    }
    return this.csvCache.get(key);
  }

  /** 找出文本中所有顶层 <$...> 的区间(平衡嵌套) */
  private findFnSpans(text: string): [number, number][] {
    const spans: [number, number][] = [];
    let i = 0;
    while (i < text.length) {
      if (text.startsWith('<$', i)) {
        let depth = 1;
        let j = i + 2;
        while (j < text.length && depth > 0) {
          if (text.startsWith('<$', j)) { depth++; j += 2; continue; }
          if (text[j] === '>') { depth--; j++; continue; }
          j++;
        }
        if (depth === 0) spans.push([i, j]);
        i = j;
        continue;
      }
      i++;
    }
    return spans;
  }

  /** 按顶层分隔符切分(跳过嵌套 <$...> 内的分隔符) */
  private splitTopLevel(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    let i = 0;
    while (i < text.length) {
      if (text.startsWith('<$', i)) { depth++; cur += '<$'; i += 2; continue; }
      if (text[i] === '>' && depth > 0) { depth--; cur += '>'; i++; continue; }
      if (text[i] === sep && depth === 0) { parts.push(cur); cur = ''; i++; continue; }
      cur += text[i];
      i++;
    }
    parts.push(cur);
    return parts;
  }

  // ---------- 内部: 变量存取 ----------

  private normVarKey(key: string): string {
    if (key.startsWith('[') || key.includes(':')) return key;
    if (NAMED_VAR_RE.test(key)) return key[0].toUpperCase() + key.slice(1);
    return key.toUpperCase();
  }

  private defaultFor(key: string): string {
    if (key.includes(':') || key.includes('$')) return '';
    const m = key.match(/^([A-Z])/);
    if (m && 'ASTZ'.includes(m[1])) return ''; // 字符型变量默认空串
    return '0';
  }

  private getVar(key: string): string {
    const k = this.normVarKey(key);
    this.touch(k);
    return this.vars.get(k) ?? this.defaultFor(k);
  }

  private setVar(key: string, value: string): void {
    const k = this.normVarKey(key);
    this.touch(k);
    this.vars.set(k, value);
  }

  private touch(key: string): void {
    if (!this.touchedOrder.includes(key)) this.touchedOrder.push(key);
  }

  private toNum(v: string): number {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  private groupOf(key: string): string {
    if (key.startsWith('[')) return '个人标记';
    if (key.startsWith('CV')) return 'CustomValue';
    if (key.includes(':')) return '自定义变量';
    if (key.includes('$')) return '命名变量';
    const prefix = key[0]?.toUpperCase();
    return PERSONAL_PREFIXES.has(prefix) ? '个人变量' : '全局变量';
  }

  private displayName(key: string): string {
    if (key.includes(':')) return key.split(':')[1];
    return key;
  }
}
