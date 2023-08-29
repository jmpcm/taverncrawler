import { randomUUID } from 'node:crypto';
import { platform } from 'node:process';
import { homedir } from 'os';
import { OutputChannel, window } from 'vscode';


export const APP_NAME: string = 'Tavern Crawler';
export const APP_NAME_ID: string = 'tavern-crawler';
export const TAVERN_CRAWLER_CONFIG_ROOT_KEY = "tavernCrawler";
export const TAVERN_FILE_EXTENSION = '.tavern.yaml';

let extensionCacheDirectory: string | undefined = undefined;
let extensionOutputChannel: OutputChannel | undefined = undefined;
let pytestPath: string | undefined = undefined;

export function getExtensionCacheDirectory(): string {
    if (extensionCacheDirectory !== undefined) {
        return extensionCacheDirectory;
    }

    if (platform === 'darwin') {
        extensionCacheDirectory = `${homedir()}/Library/Caches/${APP_NAME_ID}`;
    } else if (platform === 'linux' || platform === 'openbsd' || platform === 'freebsd') {
        extensionCacheDirectory = `${homedir()}/.${APP_NAME_ID}`;
    } else if (platform === 'win32') {
        extensionCacheDirectory = `${process.env.APPDATA}/${APP_NAME_ID}`;
    } else {
        extensionCacheDirectory = `/var/tmp/${APP_NAME_ID}`;
    }

    return extensionCacheDirectory;
}

export function getNow(): Date {
    return new Date(Date.now());
}

export function getOutputChannel(): OutputChannel {
    if (extensionOutputChannel === undefined) {
        extensionOutputChannel = window.createOutputChannel(APP_NAME);
    }

    return extensionOutputChannel;
}

export function getPytestPath(): string | undefined {
    if (pytestPath === undefined) {
        pytestPath = require('which').sync('pytest', { nothrow: true });
    };

    return pytestPath;
}

export function getSessionUuid(): string {
    const uuid = randomUUID().toString();

    return uuid.split('-', 1)[0];
}
