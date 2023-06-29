import * as vscode from 'vscode';
import { TavernCrawlerProvider } from './tavernCrawlerProvider';


export async function activate(context: vscode.ExtensionContext) {
  // const rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
  //   ? vscode.workspace.workspaceFolders[0].uri.fsPath
  //   : "undefined";
  const tavernCrawlerProvider = new TavernCrawlerProvider(context);//rootPath);

  vscode.window.createTreeView('taverncrawler', { treeDataProvider: tavernCrawlerProvider });
  await tavernCrawlerProvider.refresh();

  vscode.commands.registerCommand('taverncrawler.goToTest', (item) =>
    tavernCrawlerProvider.goToTest(item));
  vscode.commands.registerCommand('taverncrawler.runTest', (item) =>
    tavernCrawlerProvider.runTest(item));
  vscode.commands.registerCommand('taverncrawler.refresh', () =>
    tavernCrawlerProvider.refresh());
  vscode.commands.registerCommand('taverncrawler.runTests', () =>
    tavernCrawlerProvider.runAllTests());

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Tavern Crawler is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() { }
