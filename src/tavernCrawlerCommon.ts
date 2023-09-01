import { randomUUID } from 'node:crypto';
import { platform } from 'node:process';
import { homedir } from 'os';
import { parse, sep } from "path";
import { OutputChannel, window } from 'vscode';


export const APP_NAME: string = 'Tavern Crawler';
export const APP_NAME_ID: string = 'tavern-crawler';
export const TAVERN_CRAWLER_CONFIG_ROOT_KEY = "tavernCrawler";
export const TAVERN_FILE_EXTENSION = '.tavern.yaml';

let extensionCacheDirectory: string | undefined = undefined;
let extensionOutputChannel: OutputChannel | undefined = undefined;
let pytestPath: string | undefined = undefined;


function findCommonDirectory(filePaths: string[]): string | undefined {
    if (filePaths.length === 0) {
        return undefined;
    }

    if (filePaths.length === 1) {
        if (filePaths[0] === "") {
            return undefined;
        }

        try {
            return parse(filePaths[0]).dir;
        } catch (err) {
            return undefined;
        }
    }

    let commonPathTokens = parse(filePaths[0]).dir.split(sep);

    for (let i = 1; i < filePaths.length; i++) {
        if (filePaths[i] === '') {
            return undefined;
        }

        let pathTokens: string[];
        try {
            pathTokens = parse(filePaths[i]).dir.split(sep);
        } catch (err) {
            return undefined;
        }

        let pathLength = Math.min(commonPathTokens.length, pathTokens.length);
        let j = 0;
        for (; j < pathLength; j++) {
            if (commonPathTokens[j] !== pathTokens[j]) {
                break;
            }
        }

        commonPathTokens = pathTokens.slice(0, j);
    }

    if (commonPathTokens.length > 1) {
        return commonPathTokens!.join(sep);
    } else if (commonPathTokens.length === 1) {
        return commonPathTokens[0] === '' ? sep : commonPathTokens[0];
    }

    return undefined;
}


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

export function isTavernFile(file: string): boolean {
    return file.endsWith(TAVERN_FILE_EXTENSION);
}
