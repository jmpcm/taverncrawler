import { commands, ExtensionContext, window, workspace } from 'vscode';
import { TavernCrawlerProvider } from './tavernCrawlerProvider';
import { TavernCrawlerTestManager } from './tavernCrawlerTestManager';
import { getExtensionCacheDirectory, TAVERN_CRAWLER_CONFIG_ROOT_KEY } from './tavernCrawlerCommon';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'path';


export async function activate(context: ExtensionContext) {
    if (workspace.workspaceFolders === undefined || workspace.workspaceFolders.length === 0) {
        window.showErrorMessage(
            'Tavern Crawler will not load any tests, because a workspace is not open.');
        return;
    }

    let extensionOutputChannel = window.createOutputChannel("Tavern Crawler");

    // Create cache directory
    const extensionCacheDirectory: string = getExtensionCacheDirectory();
    extensionOutputChannel.appendLine(`Exists? ${existsSync(extensionCacheDirectory)}`);
    if (!existsSync(extensionCacheDirectory)) {
        extensionOutputChannel.appendLine(`Create dir ${extensionCacheDirectory}`);
        mkdirSync(extensionCacheDirectory, { recursive: true });
    }

    const workspacePath = workspace.workspaceFolders[0].uri.fsPath;
    const config = workspace.getConfiguration(TAVERN_CRAWLER_CONFIG_ROOT_KEY);
    // The nullish coalescing operator sets the value as undefined, because the setting can also be 
    // null. If the path is an empty string, then resolve to undefined.
    let testsFolderPath = config.get<string | undefined>('testsFolder', undefined) ?? undefined;
    testsFolderPath = testsFolderPath === "" ? undefined : testsFolderPath;

    if (testsFolderPath !== undefined
        && testsFolderPath !== null
        && !existsSync(join(workspacePath, testsFolderPath))) {
        window.showWarningMessage(
            'Tavern Crawler will search for tests in the entire workspace, because the folder '
            + `"${testsFolderPath}" does not exist in the open workspace.`);
        testsFolderPath = undefined;
    }

    let testsManager = new TavernCrawlerTestManager(workspacePath, testsFolderPath);
    testsManager.ouputChannel = extensionOutputChannel;

    const tavernCrawlerProvider = new TavernCrawlerProvider(context, testsManager);

    window.createTreeView('taverncrawler', { treeDataProvider: tavernCrawlerProvider });
    await tavernCrawlerProvider.refresh();

    commands.registerCommand('taverncrawler.goToTest', (item) =>
        tavernCrawlerProvider.goToTest(item));
    commands.registerCommand('taverncrawler.runTest', (item) =>
        tavernCrawlerProvider.runTest(item));
    commands.registerCommand('taverncrawler.refresh', () => {
        const config = workspace.getConfiguration(TAVERN_CRAWLER_CONFIG_ROOT_KEY);
        // The nullish coalescing operator sets the value as undefined, because the setting can also
        // be null. If the path is an empty string, then resolve to undefined.
        let testsFolderPath = config.get<string | undefined>('testsFolder', undefined)
            ?? undefined;
        testsFolderPath = testsFolderPath === "" ? undefined : testsFolderPath;

        if (testsFolderPath !== undefined
            && testsFolderPath !== null
            && !existsSync(join(workspacePath, testsFolderPath))) {
            window.showWarningMessage(
                'Tavern Crawler will search for tests in the entire workspace, because the folder '
                + `"${testsFolderPath}" does not exist in the open workspace.`);
            testsFolderPath = undefined;
        }

        testsManager.testsFolder = testsFolderPath;
        tavernCrawlerProvider.refresh();
    });
    commands.registerCommand('taverncrawler.runTests', () =>
        tavernCrawlerProvider.runAllTests());

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Tavern Crawler is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() { }
