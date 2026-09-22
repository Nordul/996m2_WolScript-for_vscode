/* 临时: 模拟 VSCode DAP 消息流驱动适配器, 排查启动即退出问题 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

class RealEmitter {
  constructor() { this.listeners = []; }
  get event() { return (l) => { this.listeners.push(l); return { dispose() {} }; }; }
  fire(msg) { for (const l of this.listeners) l(msg); }
  dispose() {}
}

const vscodeMock = {
  EventEmitter: RealEmitter,
  DebugAdapterInlineImplementation: class { constructor(a) { this.impl = a; } },
  Uri: { file: (f) => ({ fsPath: f, scheme: 'file' }) },
  window: {
    showQuickPick: async (items) => items[0],
    showInputBox: async () => '10',
    showWarningMessage: async () => undefined,
  },
  workspace: {
    fs: { readFile: async (u) => fs.readFileSync(u.fsPath) },
  },
};

const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...args);
};

const scriptPath = path.resolve('dap_demo.txt');
fs.writeFileSync(scriptPath, `[@main]
#IF
CHECK [8] 0
#ACT
MOV D0 1
SET [8] 1
BREAK
`);

const { M2DebugAdapter } = require('../out/debug/adapter');
const adapter = new M2DebugAdapter();

let reqSeq = 0;
const pending = new Map();
adapter.onDidSendMessage((msg) => {
  if (msg.type === 'response') {
    console.log(`<- response ${msg.command} success=${msg.success}${msg.message ? ' msg=' + msg.message : ''}`);
    if (pending.has(msg.request_seq)) { pending.get(msg.request_seq)(msg); pending.delete(msg.request_seq); }
  } else {
    console.log(`<- event ${msg.event} ${JSON.stringify(msg.body ?? '')}`);
  }
});

function send(command, args) {
  return new Promise((resolve) => {
    const seq = ++reqSeq;
    pending.set(seq, resolve);
    console.log(`-> request ${command}`);
    adapter.handleMessage({ seq, type: 'request', command, arguments: args });
  });
}

(async () => {
  await send('initialize', {});
  // 模拟 VSCode 抢跑: launch/setBreakpoints/configurationDone 连续发出, 不等响应
  send('setBreakpoints', { source: { path: scriptPath }, breakpoints: [{ line: 4 }] });
  send('launch', { program: scriptPath, stopOnEntry: true });
  send('setExceptionBreakpoints', { filters: [] });
  await send('configurationDone');
  await new Promise((r) => setTimeout(r, 800));
  await send('threads');
  await send('stackTrace', { threadId: 1 });
  await send('scopes', { frameId: 1 });
  await send('continue', { threadId: 1 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('done');
})();
