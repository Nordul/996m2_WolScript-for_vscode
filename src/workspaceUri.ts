import * as vscode from 'vscode';
import * as path from 'path';

export function isWorkspaceScheme(scheme: string): boolean {
  return scheme === 'file' || scheme === 'vscode-remote';
}

export function workspaceUri(fsPath: string, source?: vscode.Uri): vscode.Uri {
  const uri = vscode.Uri.file(fsPath);
  if (!source || source.scheme === 'file') return uri;
  return uri.with({ scheme: source.scheme, authority: source.authority });
}

export function workspaceFolderUri(fsPath: string): vscode.Uri | undefined {
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const relative = path.relative(folder.uri.fsPath, fsPath);
    if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      return folder.uri;
    }
  }
  return undefined;
}
