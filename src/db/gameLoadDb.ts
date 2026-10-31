import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Database, SqlJsStatic } from 'sql.js';
import { IGNORE_GLOB } from '../scanner/scanCore';
import * as q from './dbQueries';

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

/** sql.js WASM 加载 (单例); wasm 文件从扩展目录 node_modules 内定位。动态引入: sql.js 缺失时不影响插件激活 */
function getSqlJs(context: vscode.ExtensionContext): Promise<SqlJsStatic> {
  sqlJsPromise ??= (async () => {
    const { default: initSqlJs } = await import('sql.js');
    return initSqlJs({
      locateFile: (file) => path.join(context.extensionPath, 'node_modules', 'sql.js', 'dist', file),
    });
  })();
  return sqlJsPromise;
}

let dbPromise: Promise<Database | null> | undefined;

/** 定位 GameLoad.DB 并读出字节: 先全工作区找, 找不到再从当前脚本文件向上找 Envir\DB\GameLoad.DB */
async function locateDbBytes(): Promise<Uint8Array | null> {
  const uris = await vscode.workspace.findFiles('**/GameLoad.DB', IGNORE_GLOB, 1);
  if (uris.length) return vscode.workspace.fs.readFile(uris[0]);
  // 兜底: 工作区根可能是 QuestDiary 等子目录, 沿打开的脚本文件向上找 DB\GameLoad.DB
  const editor = vscode.window.activeTextEditor;
  let dir = editor && editor.document.uri.scheme === 'file'
    ? path.dirname(editor.document.uri.fsPath)
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  while (dir) {
    const cand = path.join(dir, 'DB', 'GameLoad.DB');
    try {
      if (fs.existsSync(cand)) return fs.readFileSync(cand);
    } catch { /* 读取失败继续向上 */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 定位并打开 GameLoad.DB (懒加载 + 缓存); 失败结果不缓存, 下次调用时重试 */
export async function loadGameLoadDb(context: vscode.ExtensionContext): Promise<Database | null> {
  const pending = dbPromise ??= (async () => {
    try {
      const bytes = await locateDbBytes();
      if (!bytes) return null;
      const SQL = await getSqlJs(context);
      return new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    } catch (e) {
      console.error('[M2Script] GameLoad.DB 加载失败:', e);
      return null;
    }
  })();
  const db = await pending;
  if (!db && dbPromise === pending) dbPromise = undefined;
  return db;
}

/** 重新定位 DB (数据库查看器「刷新」用; 名称缓存一并清空) */
export function invalidateGameLoadDb(): void {
  dbPromise = undefined;
  namesCache.clear();
}

/** 名称缓存: kind -> 解码去重后的名称列表 */
const namesCache = new Map<q.NameKind, string[]>();

/** 物品/怪物/技能名称补全数据源; DB 不存在时返回 null (调用方静默跳过) */
export async function getDbNames(context: vscode.ExtensionContext | undefined, kind: q.NameKind): Promise<string[] | null> {
  const cached = namesCache.get(kind);
  if (cached) return cached;
  if (!context) return null;
  const db = await loadGameLoadDb(context);
  if (!db) return null;
  const names = q.getNames(db, kind);
  namesCache.set(kind, names);
  return names;
}
