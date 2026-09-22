import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Interpreter, RunMode, VarItem } from './interpreter';
import { decodeScript } from '../scanner/scanCore';

const DAP_LOG = path.join(os.tmpdir(), 'm2script-dap.log');

function dapLog(text: string): void {
  try {
    fs.appendFileSync(DAP_LOG, `[${new Date().toISOString()}] ${text}\n`);
  } catch {
    /* 日志失败不影响调试 */
  }
}

/** 向上查找祖先目录中的 QuestDiary 根目录 */
function ancestorQuestDiary(fsPath: string): string | undefined {
  let dir = path.dirname(fsPath);
  while (true) {
    if (path.basename(dir).toLowerCase() === 'questdiary') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readScriptFile(fsPath: string): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
    return decodeScript(bytes);
  } catch {
    return undefined;
  }
}

/** 内联 DAP 调试适配器: 驱动脚本解释器 */
export class M2DebugAdapter implements vscode.DebugAdapter {
  private seq = 1;
  private readonly sendEmitter = new vscode.EventEmitter<Record<string, unknown>>();
  readonly onDidSendMessage = this.sendEmitter.event;
  private interp?: Interpreter;
  private launchArgs: Record<string, unknown> = {};
  private launchTask?: Promise<void>;
  private pendingBreakpoints = new Map<string, number[]>();
  private varRefs = new Map<number, VarItem[]>();
  private nextVarRef = 1;
  private launchArrived: Promise<void>;
  private launchArrivedResolve!: () => void;

  constructor() {
    this.launchArrived = new Promise((r) => {
      this.launchArrivedResolve = r;
    });
  }

  handleMessage(message: Record<string, unknown>): void {
    if (message.type !== 'request') return;
    dapLog(`-> ${message.command} ${JSON.stringify(message.arguments ?? {}).slice(0, 300)}`);
    void this.dispatch(message).catch((e) => {
      dapLog(`!! ${String(message.command)} 异常: ${String((e as Error).stack ?? e)}`);
      this.respond(message, undefined, false, String(e));
    });
  }

  dispose(): void {
    this.sendEmitter.dispose();
  }

  private send(msg: Record<string, unknown>): void {
    dapLog(`<- ${String(msg.type)} ${String(msg.command ?? msg.event ?? '')} ${JSON.stringify(msg.body ?? '').slice(0, 200)}`);
    this.sendEmitter.fire({ seq: this.seq++, ...msg });
  }

  private respond(req: Record<string, unknown>, body?: unknown, success = true, message?: string): void {
    this.send({ type: 'response', request_seq: req.seq, command: req.command, success, body: body ?? {}, message });
  }

  private event(name: string, body?: unknown): void {
    this.send({ type: 'event', event: name, body: body ?? {} });
  }

  private output(text: string): void {
    this.event('output', { category: 'console', output: text + '\n' });
  }

  private async dispatch(req: Record<string, any>): Promise<void> {
    const args = req.arguments ?? {};
    switch (req.command) {
      case 'initialize':
        this.respond(req, {
          supportsConfigurationDoneRequest: true,
          supportsEvaluateForHovers: true,
          supportsSetVariable: false,
          supportsStepBack: false,
        });
        this.event('initialized');
        return;

      case 'launch': {
        // VSCode 可能不等 launch 响应就发送 setBreakpoints/configurationDone(initialized 事件触发),
        // 用 launchTask 串行化: configurationDone 必须等 launch 完成
        this.launchArrivedResolve();
        this.launchTask = this.doLaunch(req, args);
        await this.launchTask;
        return;
      }

      case 'setBreakpoints': {
        const file = String(args.source?.path ?? '');
        const lines: number[] = (args.breakpoints ?? []).map((b: { line: number }) => b.line - 1);
        // launch 未完成时先缓存, 创建解释器后统一应用
        this.pendingBreakpoints.set(file, lines);
        this.interp?.setBreakpoints(file, lines);
        this.output(`断点设置: ${path.basename(file)} 行 [${lines.map((l) => l + 1).join(', ') || '无'}]`);
        this.respond(req, {
          breakpoints: lines.map((l) => ({ verified: true, line: l + 1 })),
        });
        return;
      }

      case 'setExceptionBreakpoints':
        this.respond(req, { breakpoints: [] });
        return;

      case 'configurationDone': {
        // configurationDone 甚至可能比 launch 请求更早到达(均由 initialized 事件触发)
        await this.launchArrived;
        await this.launchTask;
        this.respond(req);
        if (!this.interp) {
          this.output('launch 未完成, 无法开始执行');
          return;
        }
        const stopOnEntry = this.launchArgs.stopOnEntry !== false;
        await this.runAndSend(stopOnEntry ? 'entry' : 'continue');
        return;
      }

      case 'threads':
        this.respond(req, { threads: [{ id: 1, name: '脚本主线程' }] });
        return;

      case 'stackTrace': {
        const frames = (this.interp?.stackTrace() ?? []).slice().reverse();
        this.respond(req, {
          stackFrames: frames.map((f) => ({
            id: f.id,
            name: f.label,
            line: f.line + 1,
            column: 1,
            source: { name: path.basename(f.file), path: f.file },
          })),
          totalFrames: frames.length,
        });
        return;
      }

      case 'scopes': {
        this.varRefs.clear();
        this.nextVarRef = 1;
        const items = this.interp?.snapshotVars() ?? [];
        const groups = ['个人变量', '全局变量', '命名变量', '个人标记', 'CustomValue', '自定义变量', '游戏状态模拟值'];
        const scopes = groups
          .map((g) => ({ name: g, items: items.filter((it) => it.group === g) }))
          .filter((g) => g.items.length > 0)
          .map((g) => {
            const ref = this.nextVarRef++;
            this.varRefs.set(ref, g.items);
            return { name: g.name, variablesReference: ref, expensive: false };
          });
        this.respond(req, { scopes });
        return;
      }

      case 'variables': {
        const items = this.varRefs.get(Number(args.variablesReference)) ?? [];
        this.respond(req, {
          variables: items.map((it) => ({ name: it.name, value: it.value, variablesReference: 0 })),
        });
        return;
      }

      case 'evaluate': {
        const result = this.interp?.evaluate(String(args.expression ?? '')) ?? '';
        this.respond(req, { result, variablesReference: 0 });
        return;
      }

      case 'continue':
        this.respond(req, { allThreadsContinued: true });
        await this.runAndSend('continue');
        return;

      case 'next':
        this.respond(req);
        await this.runAndSend('next');
        return;

      case 'stepIn':
        this.respond(req);
        await this.runAndSend('stepIn');
        return;

      case 'stepOut':
        this.respond(req);
        await this.runAndSend('stepOut');
        return;

      case 'pause':
        this.interp?.requestPause();
        this.respond(req);
        return;

      case 'disconnect':
        this.respond(req);
        this.event('terminated');
        return;

      default:
        this.respond(req);
    }
  }

  private async doLaunch(req: Record<string, unknown>, args: Record<string, any>): Promise<void> {
    const program = String(args.program ?? '');
    if (!program) {
      this.respond(req, undefined, false, '未指定调试文件(program)');
      return;
    }
    const text = await readScriptFile(program);
    if (text === undefined) {
      this.respond(req, undefined, false, `无法读取脚本文件: ${program}`);
      return;
    }
    this.interp = new Interpreter({
      entryFile: program,
      entryText: text,
      maxSteps: typeof args.maxSteps === 'number' ? args.maxSteps : 100000,
      loadFile: async (rel, fromFile) => {
        const root = ancestorQuestDiary(fromFile);
        if (!root) return undefined;
        const target = path.join(root, rel.replace(/^[/\\]+/, '').split(/[/\\]+/).join(path.sep));
        const content = await readScriptFile(target);
        return content === undefined ? undefined : { fileKey: target, text: content };
      },
      loadCsv: async (name, fromFile) => {
        const root = ancestorQuestDiary(fromFile);
        if (!root) return undefined;
        return readScriptFile(path.join(root, `cfg_${name}.csv`));
      },
      ask: {
        askCheck: async (expr) => {
          const pick = await vscode.window.showQuickPick(['通过', '不通过'], {
            placeHolder: `检测命令需要在游戏内验证, 请选择结果: ${expr}`,
          });
          return pick === '通过';
        },
        askValue: async (expr, prev) => {
          const v = await vscode.window.showInputBox({
            prompt: `请输入游戏状态值: ${expr}`,
            value: prev ?? '',
            placeHolder: '数字或文本(游戏内实际值)',
          });
          return v ?? '0';
        },
      },
      onOutput: (t) => this.output(t),
    });
    // 应用 launch 完成前缓存的断点
    for (const [file, lines] of this.pendingBreakpoints) this.interp.setBreakpoints(file, lines);
    this.launchArgs = args;
    this.output(`已加载脚本: ${program} (共 ${text.split(/\r?\n/).length} 行)`);
    // 预设变量(launch.json 的 presetVars), 用于进入依赖游戏状态的分支
    if (args.presetVars && typeof args.presetVars === 'object') {
      this.interp.presetVars(args.presetVars as Record<string, string>);
      this.output(`已预设变量: ${Object.entries(args.presetVars as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    this.respond(req);
  }

  private async runAndSend(mode: RunMode): Promise<void> {
    if (!this.interp) {
      this.event('terminated');
      return;
    }
    const stop = await this.interp.run(mode);
    if (!stop) {
      this.output('脚本执行完毕');
      this.event('terminated');
      return;
    }
    if (stop.reason === 'maxSteps') {
      this.output('已达最大执行步数(可能存在死循环), 自动暂停');
    }
    this.output(`已暂停: ${path.basename(stop.file)}:${stop.line + 1} (${stop.reason})`);
    const reasonMap: Record<string, string> = {
      entry: 'entry',
      breakpoint: 'breakpoint',
      pause: 'pause',
      step: 'step',
      maxSteps: 'step',
    };
    this.event('stopped', { reason: reasonMap[stop.reason] ?? 'step', threadId: 1, allThreadsStopped: true });
  }
}
