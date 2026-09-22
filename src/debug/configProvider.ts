import * as vscode from 'vscode';
import { M2DebugAdapter } from './adapter';

/** 无 launch.json 时提供默认调试配置; program 缺省取当前编辑器文件 */
export class M2DebugConfigProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [
      {
        name: '调试当前996脚本',
        type: 'm2script',
        request: 'launch',
        program: '${file}',
        stopOnEntry: true,
      },
    ];
  }

  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration | undefined {
    if (!config.type && !config.request && !config.name) {
      Object.assign(config, {
        name: '调试当前996脚本',
        type: 'm2script',
        request: 'launch',
      });
    }
    if (!config.program) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file') {
        void vscode.window.showWarningMessage('请先打开要调试的996脚本文件');
        return undefined;
      }
      config.program = editor.document.uri.fsPath;
    }
    if (config.stopOnEntry === undefined) config.stopOnEntry = true;
    return config;
  }
}

export class M2DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.DebugAdapterDescriptor {
    return new vscode.DebugAdapterInlineImplementation(new M2DebugAdapter());
  }
}
