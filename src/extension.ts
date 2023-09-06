import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'path';
import { ExtensionContext, commands, window, workspace } from 'vscode';
import {
    TAVERN_CRAWLER_CONFIG_ROOT_KEY,
    getExtensionCacheDirectory,
    getOutputChannel
} from './tavernCrawlerCommon';
import { importApiSpecificationFromUrl } from './tavernCrawlerOpenApi';
import { TavernCrawlerProvider } from './tavernCrawlerProvider';


export async function activate(context: ExtensionContext) {
    if (workspace.workspaceFolders === undefined || workspace.workspaceFolders.length === 0) {
        window.showErrorMessage(
            'Tavern Crawler will not load any tests, because a workspace is not open.');
        return;
    }

    const extensionOutputChannel = getOutputChannel();

    // Create cache directory
    const extensionCacheDirectory: string = getExtensionCacheDirectory();

    if (!existsSync(extensionCacheDirectory)) {
        extensionOutputChannel.append(`Creating cache directory ${extensionCacheDirectory}...`);
        mkdirSync(extensionCacheDirectory, { recursive: true });
        extensionOutputChannel.appendLine(' done');
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

    // let testsManager = new TavernCrawlerTestManager(workspacePath, testsFolderPath);
    // testsManager.ouputChannel = getOutputChannel();

    const tavernCrawlerProvider = new TavernCrawlerProvider(workspacePath, testsFolderPath);//, testsManager);

    window.createTreeView('taverncrawler', { treeDataProvider: tavernCrawlerProvider });
    await tavernCrawlerProvider.refresh();

    workspace.onDidChangeConfiguration(() => {
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

        tavernCrawlerProvider.testsFolderPath = testsFolderPath;
        tavernCrawlerProvider.refresh();
    });

    commands.registerCommand('taverncrawler.importOpenApi', () => importApiSpecificationFromUrl());
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

        tavernCrawlerProvider.testsFolderPath = testsFolderPath;
        tavernCrawlerProvider.refresh();
    });
    commands.registerCommand('taverncrawler.runTests', () =>
        tavernCrawlerProvider.runAllTests());
}

// This method is called when your extension is deactivated
export function deactivate() { }
