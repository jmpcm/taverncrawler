import { existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:process';
import { homedir } from 'os';


const APP_NAME: string = 'tavern-crawler';
let extensionCacheDirectory: string | undefined = undefined;
let pytestPath: string | undefined = undefined;

export function getExtensionCacheDirectory(create: boolean = true): string {
    if (extensionCacheDirectory !== undefined) {
        return extensionCacheDirectory;
    }

    if (platform === 'darwin') {
        extensionCacheDirectory = `${homedir()}/Library/Caches/${APP_NAME}`;
    } else if (platform === 'linux' || platform === 'openbsd' || platform === 'freebsd') {
        extensionCacheDirectory = `${homedir()}/.${APP_NAME}`;
    } else if (platform === 'win32') {
        extensionCacheDirectory = `${process.env.APPDATA}/${APP_NAME}`;
    } else {
        extensionCacheDirectory = `/var/tmp/${APP_NAME}`;
    }

    if (create && !existsSync(extensionCacheDirectory)) {
        mkdirSync(extensionCacheDirectory, { recursive: true });
    }

    return extensionCacheDirectory;
}

export function getPytestPath(): string | undefined {
    if (pytestPath !== undefined) {
        return pytestPath;
    };

    const which = require('which');

    pytestPath = which.sync('pytest', { nothrow: true });

    return pytestPath;
}