import { existsSync, readFile, writeFile } from 'fs';
import { promisify } from 'util';
import { getCachedState, TavernCrawlerTest, TavernTestResult } from './tavernCrawlerTest';


export class TavernCrawlerTestsCache extends Map<string, TavernTestResult> {
    private _cacheLoaded: boolean = false;
    private _savingToFile: boolean = false;

    constructor(public filePath: string) {
        super();
        this.filePath = filePath;
    }

    getResult(test: TavernCrawlerTest): TavernTestResult | undefined;
    getResult(nodeId: string): TavernTestResult | undefined;
    getResult(testOrNodeId: string | TavernCrawlerTest): TavernTestResult | undefined {
        let result = this.get(testOrNodeId instanceof TavernCrawlerTest
            ? testOrNodeId.nodeId
            : testOrNodeId);

        if (result === undefined) {
            return result;
        }

        result.state = getCachedState(result.state);

        return result;
    }

    async load(filePath?: string, reload: boolean = false): Promise<void> {
        if (this._cacheLoaded && !reload) {
            return;
        }

        if (filePath === undefined && reload) {
            throw new Error('A path for the cache file was not specified. Nothing was reloaded.');
        }

        const filetoLoad = filePath ?? this.filePath;
        this.filePath = filetoLoad;

        if (!existsSync(filetoLoad)) {
            throw new Error(`The cache file ${filePath} does not exist. Nothing was loaded.`);
        }

        const readFileAsync = promisify(readFile);
        const fileContent = await readFileAsync(filetoLoad, 'utf-8');

        this.clear();

        for (const result of Object.entries(JSON.parse(fileContent))) {
            this.set(result[0], result[1] as TavernTestResult);
        }

        this._cacheLoaded = true;
    }

    async save(filePath?: string): Promise<void> {
        if (this._savingToFile
            || (this.filePath === undefined && filePath === undefined)) {
            return;
        }
        this._savingToFile = true;

        let file: string = (filePath ?? this.filePath)!;

        writeFile(file, await this.toJson(), 'utf8', () => { this._savingToFile = false; });
    }

    setResult(test: TavernCrawlerTest | TavernCrawlerTest[]): void {
        if (test === undefined) {
            throw new Error("test object can't be undefined");
        }

        let testsToAppend = test instanceof TavernCrawlerTest ? [test] : test;

        testsToAppend.forEach(test => {
            this.set(test.nodeId, test.result);
        });
    }

    async toJson(): Promise<string> {
        return JSON.stringify(Object.fromEntries(this));
    }
}