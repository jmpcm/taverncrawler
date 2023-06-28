import { existsSync, readFile } from 'fs';
import { promisify } from 'util';
import { TavernTest, TavernTestResult } from './tavernTest';


export class TavernTestCache extends Map<string, TavernTestResult> {
    constructor(json?: string) {
        super(json ? JSON.parse(json) : undefined);
    }

    getResult(test: TavernTest): TavernTestResult | undefined;
    getResult(nodeId: string): TavernTestResult | undefined;
    getResult(testOrNodeId: string | TavernTest): TavernTestResult | undefined {
        return this.get(testOrNodeId instanceof TavernTest ? testOrNodeId.nodeId : testOrNodeId);
    }

    static async fromFile(filePath: string): Promise<TavernTestCache | undefined> {
        if (!existsSync(filePath)) {
            return undefined;
        }

        const readFileAsync = promisify(readFile);
        const fileContent = await readFileAsync(filePath, 'utf-8');

        return new this(fileContent);
    }

    setResult(test: TavernTest | TavernTest[]): void {
        if (test === undefined) {
            throw new Error("test object can't be undefined");
        }

        let testsToAppend = test instanceof TavernTest ? [test] : test;

        testsToAppend.forEach(test => {
            this.set(test.nodeId, test.result);
        });
    }

    async toJson(): Promise<string> {
        return JSON.stringify(this);
    }
}