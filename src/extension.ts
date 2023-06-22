import * as vscode from 'vscode';
import { TavernTrackerProvider } from './tavernTrackerProvider';


export async function activate(context: vscode.ExtensionContext) {
  // const rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
  //   ? vscode.workspace.workspaceFolders[0].uri.fsPath
  //   : "undefined";
  const tavernTrackerProvider = new TavernTrackerProvider(context);//rootPath);

  // vscode.window.registerTreeDataProvider('taverntracker', tavernTrackerProvider);
  vscode.window.createTreeView('taverntracker', { treeDataProvider: tavernTrackerProvider });
  await tavernTrackerProvider.refresh();

  vscode.commands.registerCommand('taverntracker.goToTest', (item) =>
    tavernTrackerProvider.goToTest(item));
  vscode.commands.registerCommand('taverntracker.runTest', (item) =>
    tavernTrackerProvider.runTest(item));
  vscode.commands.registerCommand('taverntracker.refresh', () =>
    tavernTrackerProvider.refresh());
  vscode.commands.registerCommand('taverntracker.runTests', () =>
    tavernTrackerProvider.runAllTests());

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Tavern Tracker is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() { }
