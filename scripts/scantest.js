/* 用 mock vscode 验证 VarScanner.scanWorkspace 能正常完成并发出进度: node scripts/scantest.js */
const Module = require('module');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'example');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.txt')) out.push(p);
  }
  return out;
}
const files = walk(root);
console.log('磁盘文件数:', files.length);

const vscodeMock = {
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: { fsPath: root } }],
    asRelativePath: (u) => path.relative(root, u.fsPath),
    findFiles: async () => files.map((f) => ({ fsPath: f, scheme: 'file' })),
    fs: { readFile: async (u) => fs.readFileSync(u.fsPath) },
  },
};
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...args);
};

(async () => {
  const { VarScanner } = require('../out/scanner/varScanner');
  const scanner = new VarScanner();
  let lastP = null, nullGot = false;
  scanner.onDidProgress((p) => { if (p === null) nullGot = true; else lastP = p; });
  const t0 = Date.now();
  const result = await scanner.scanWorkspace();
  const groups = Object.keys(result.groups);
  let vars = 0;
  for (const g of groups) vars += Object.keys(result.groups[g]).length;
  console.log(`完成: ${result.fileCount} 文件, ${vars} 变量, 分组[${groups.join(',')}], 耗时 ${Date.now() - t0}ms, 最后进度 ${JSON.stringify(lastP)}, 收到结束信号 ${nullGot}`);
  process.exit(result.fileCount > 0 && nullGot ? 0 : 1);
})().catch((e) => { console.error('FAIL 异常:', e); process.exit(1); });
