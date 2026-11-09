/* 变量索引全量/缓存/增量/并发/单文件事件测试: node scripts/scantest.js */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const iconv = require('iconv-lite');

const root = path.join(__dirname, '..', 'example');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(?:txt|csv)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(root);
const csvVirtual = path.join(root, 'QuestDiary', 'cfg_变量扫描测试.csv');
files.push(csvVirtual);
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm2scan-cache-'));
let csvText = '名称,<$STR(S77)>,<$STR(P88)>,[66],<$HUMAN(CsvPlayer)>\n';
let csvStat = { mtime: 1000, size: iconv.encode(csvText, 'gbk').length };
let includeGlob = '';
let readCount = 0;
let activeReads = 0;
let maxActiveReads = 0;
const readFiles = [];
const handlers = { open: [], change: [], save: [], close: [], folders: [] };
const watchers = new Set();

const uri = (fsPath, scheme = 'file') => ({
  fsPath, scheme, authority: scheme === 'file' ? '' : 'ssh-remote+test',
  path: fsPath.replace(/\\/g, '/'),
});
const event = (name) => (fn) => {
  handlers[name].push(fn);
  return { dispose() { handlers[name] = handlers[name].filter((item) => item !== fn); } };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trigger = (name, arg) => { for (const fn of [...handlers[name]]) fn(arg); };

const vscodeMock = {
  Uri: {
    joinPath: (base, ...parts) => ({ ...base, fsPath: path.join(base.fsPath, ...parts) }),
  },
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: uri(root) }],
    asRelativePath: (u) => path.relative(root, u.fsPath),
    findFiles: async (include) => {
      includeGlob = include;
      return files.map((f) => uri(f));
    },
    onDidOpenTextDocument: event('open'),
    onDidChangeTextDocument: event('change'),
    onDidSaveTextDocument: event('save'),
    onDidCloseTextDocument: event('close'),
    onDidChangeWorkspaceFolders: event('folders'),
    createFileSystemWatcher: () => {
      const watcherHandlers = { create: [], change: [], delete: [] };
      const watcher = {
        handlers: watcherHandlers,
        onDidCreate: (fn) => { watcherHandlers.create.push(fn); return { dispose() {} }; },
        onDidChange: (fn) => { watcherHandlers.change.push(fn); return { dispose() {} }; },
        onDidDelete: (fn) => { watcherHandlers.delete.push(fn); return { dispose() {} }; },
        dispose: () => watchers.delete(watcher),
      };
      watchers.add(watcher);
      return watcher;
    },
    fs: {
      stat: async (u) => {
        if (u.fsPath === csvVirtual) return csvStat;
        const stat = fs.statSync(u.fsPath);
        return { mtime: stat.mtimeMs, size: stat.size };
      },
      readFile: async (u) => {
        if (u.fsPath.startsWith(storageRoot)) return fs.readFileSync(u.fsPath);
        readCount++;
        readFiles.push(u.fsPath);
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await sleep(2);
        try {
          return u.fsPath === csvVirtual ? iconv.encode(csvText, 'gbk') : fs.readFileSync(u.fsPath);
        } finally {
          activeReads--;
        }
      },
      createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }),
      writeFile: async (u, bytes) => fs.writeFileSync(u.fsPath, bytes),
      rename: async (from, to) => fs.renameSync(from.fsPath, to.fsPath),
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...args);
};

function makeDoc(file, text, scheme = 'file') {
  return {
    languageId: 'm2script',
    uri: uri(file, scheme),
    version: 1,
    getText: () => text,
  };
}

(async () => {
  console.log('磁盘文件数:', files.length);
  const { VarScanner, isEngineScriptPath } = require('../out/scanner/varScanner');
  const engineFileCount = files.filter(isEngineScriptPath).length;
  const context = { globalStorageUri: uri(storageRoot) };
  const remotePath = path.join(root, 'QuestDiary', '远程打开.txt');
  vscodeMock.workspace.textDocuments = [makeDoc(remotePath, 'MOV S99 远程变量\n', 'vscode-remote')];

  const first = new VarScanner(context);
  let lastP = null;
  let nullGot = false;
  first.onDidProgress((p) => { if (p === null) nullGot = true; else lastP = p; });
  const t0 = Date.now();
  const result = await first.initialize();
  await first.flush();
  const groups = Object.keys(result.groups);
  let vars = 0;
  for (const g of groups) vars += Object.keys(result.groups[g]).length;
  console.log(`完成: ${result.fileCount} 文件, ${vars} 变量, 分组[${groups.join(',')}], 耗时 ${Date.now() - t0}ms, 最后进度 ${JSON.stringify(lastP)}, 最大读取并发 ${maxActiveReads}`);
  const csvRefs = [result.groups.S?.S77, result.groups.P?.P88, result.groups.MARK?.['[66]'], result.groups.CUSTOM?.CsvPlayer];
  const csvOk = includeGlob === '**/*.{txt,csv}' && csvRefs.every((refs) => refs?.some((r) => r.absPath === csvVirtual));
  const remoteOk = result.groups.S?.S99?.some((r) => r.absPath === remotePath);
  assert(csvOk && remoteOk && nullGot, '首次全量扫描应包含 CSV 和远程未保存文档');
  assert(maxActiveReads > 1 && maxActiveReads <= 8, '本地扫描应使用受限并发');
  assert.strictEqual(readCount, engineFileCount, '首次扫描应读取全部磁盘文件');
  console.log('PASS 首次全量扫描、CSV/SSH文档与受限并发');
  first.dispose();

  vscodeMock.workspace.textDocuments = [];
  readCount = 0;
  readFiles.length = 0;
  const second = new VarScanner(context);
  const secondResults = [];
  second.onDidScan((r) => secondResults.push(r));
  const restored = await second.initialize();
  assert(secondResults[0]?.fromCache, '第二次启动应先发出缓存结果');
  assert(secondResults[0].groups.S?.S77, '缓存结果应立即包含上次变量');
  assert.strictEqual(restored.fromCache, false, '后台校验后应切换为正式索引');
  assert.strictEqual(readCount, 0, '文件未变化时第二次启动不应读取脚本内容');
  console.log('PASS 持久缓存先展示、后台校验零读取');
  second.dispose();

  csvText = '名称,<$STR(S78)>,<$STR(P88)>,[66],<$HUMAN(CsvPlayer)>\n';
  csvStat = { mtime: 2000, size: iconv.encode(csvText, 'gbk').length };
  readCount = 0;
  readFiles.length = 0;
  const third = new VarScanner(context);
  const incremental = await third.initialize();
  assert.strictEqual(readCount, 1, '单个文件变化时只读取该文件');
  assert.strictEqual(readFiles[0], csvVirtual);
  assert(incremental.groups.S?.S78 && !incremental.groups.S?.S77, '增量结果应替换旧文件索引');
  console.log('PASS 单文件磁盘变化增量扫描');

  let docText = 'MOV S66 1\n';
  const doc = makeDoc(csvVirtual, docText);
  doc.getText = () => docText;
  vscodeMock.workspace.textDocuments = [doc];
  trigger('open', doc);
  trigger('save', doc);
  await sleep(60);
  assert(third.getResult().groups.S?.S66, '保存当前文件应立即更新索引');
  assert.strictEqual(readCount, 1, '保存事件不应重新读取或全量扫描');
  console.log('PASS 保存单文件更新且不读取磁盘');

  docText = 'MOV S65 1\n';
  doc.version++;
  trigger('change', { document: doc });
  await sleep(330);
  assert(third.getResult().groups.S?.S65 && !third.getResult().groups.S?.S66, '未保存修改应实时更新覆盖层');
  assert.strictEqual(readCount, 1, '未保存修改不应读取磁盘');
  console.log('PASS 未保存文档实时索引');

  vscodeMock.workspace.textDocuments = [];
  trigger('close', doc);
  await sleep(60);
  assert(third.getResult().groups.S?.S78 && !third.getResult().groups.S?.S65, '关闭未保存文档后应恢复磁盘索引');
  assert.strictEqual(readCount, 2, '关闭文档只需重读当前文件');
  console.log('PASS 关闭文档恢复单文件磁盘索引');

  readCount = 0;
  await third.scanWorkspace(true);
  assert.strictEqual(readCount, engineFileCount, '手动刷新应强制全量重建');
  console.log('PASS 手动刷新强制全量重建');

  csvText = '名称,<$STR(S79)>\n';
  csvStat = { mtime: 3000, size: iconv.encode(csvText, 'gbk').length };
  readCount = 0;
  for (const watcher of watchers) for (const fn of watcher.handlers.change) fn(uri(csvVirtual));
  await sleep(60);
  assert(third.getResult().groups.S?.S79 && !third.getResult().groups.S?.S78, '外部文件变化应更新单文件索引');
  assert.strictEqual(readCount, 1);
  console.log('PASS 文件监听器处理外部变化');

  for (const watcher of watchers) for (const fn of watcher.handlers.delete) fn(uri(csvVirtual));
  await sleep(40);
  assert(!third.getResult().groups.S?.S79, '删除文件后应移除对应变量');
  console.log('PASS 删除文件移除索引');

  await third.flush();
  third.dispose();

  vscodeMock.workspace.workspaceFolders = [{ uri: uri(root, 'vscode-remote') }];
  maxActiveReads = 0;
  const remoteScanner = new VarScanner();
  await remoteScanner.scanWorkspace(true);
  assert(maxActiveReads > 1 && maxActiveReads <= 4, 'SSH 工作区读取并发不应超过 4');
  remoteScanner.dispose();
  vscodeMock.workspace.workspaceFolders = [{ uri: uri(root) }];
  console.log('PASS SSH工作区最多4并发');

  console.log('scantest 全部通过');
})().catch((e) => {
  console.error('FAIL 异常:', e);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});
