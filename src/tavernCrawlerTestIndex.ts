import { basename } from 'path';
import { TavernCrawlerTest, TavernTestType } from './tavernCrawlerTest';


export class TavernCrawlerTestsIndex extends Map<string, TavernCrawlerTest> {
    private _filesNodeIdsIndex = new Map<string, Set<string>>();

    addTest(test: TavernCrawlerTest | TavernCrawlerTest[]): void {
        if (test === undefined) {
            throw new Error("test object can't be undefined");
        }

        let testsToAppend = test instanceof TavernCrawlerTest ? [test] : test;

        testsToAppend.forEach(test => {
            let parentTestFile = this.get(test.fileLocation);

            if (parentTestFile === undefined) {
                parentTestFile = new TavernCrawlerTest(
                    basename(test.fileLocation),
                    TavernTestType.File,
                    test.fileLocation);
                parentTestFile.relativeFileLocation = test.relativeFileLocation ?? '';
            }

            if (!this.has(parentTestFile.nodeId)) {
                this.set(parentTestFile.nodeId, parentTestFile);
            }

            if (test.type === TavernTestType.Test) {
                test.parentTest = parentTestFile;
                parentTestFile.addChildrenTests(test);
                test.childrenTests.forEach(child => this.addTest(child));
            }

            this.set(test.nodeId, test);
            this._addToFileNodeIdsIndex(test.fileLocation, test.nodeId);
        });
    }

    private _addToFileNodeIdsIndex(file: string, nodeId: string | string[]): void {
        let nodeIds = this._filesNodeIdsIndex.get(file);

        if (nodeIds === undefined) {
            this._filesNodeIdsIndex.set(
                file,
                new Set<string>(typeof nodeId === 'string' ? [nodeId] : nodeId));
        } else {
            if (typeof nodeId === 'string') {
                nodeIds.add(nodeId);
            } else {
                nodeId.forEach(nodeIds.add, nodeIds);
            }
        }
    }

    filter(type: TavernTestType): TavernCrawlerTest[] {
        let results: TavernCrawlerTest[] = [];

        this.forEach((test, _) => {
            if (test.type === type) {
                results.push(test);
            }
        });

        return results;
    }

    getTest(test: TavernCrawlerTest): TavernCrawlerTest | undefined;
    getTest(nodeId: string): TavernCrawlerTest | undefined;
    getTest(callback: (test: TavernCrawlerTest) => boolean): TavernCrawlerTest | undefined;
    getTest(testOrNodeId: string | TavernCrawlerTest | TavernTestType | ((test: TavernCrawlerTest) => boolean)):
        TavernCrawlerTest | TavernCrawlerTest[] | undefined {
        // return this.get(testOrNodeId instanceof TavernTest ? testOrNodeId.nodeId : testOrNodeId);
        if (testOrNodeId instanceof TavernCrawlerTest) {
            return this.get(testOrNodeId.nodeId);
        } else if (typeof testOrNodeId === 'string') {
            return this.get(testOrNodeId);
        } else {
            for (const [_, test] of this) {
                if (testOrNodeId(test)) {
                    return test;
                }
            }

            return undefined;
        }
    }

    getTestsForFile(file: string): TavernCrawlerTest[] {
        const nodeIds = this._filesNodeIdsIndex.get(file);
        let tests: TavernCrawlerTest[] = [];

        this.forEach(t => {
            if (nodeIds?.has(t.nodeId)) {
                tests = tests.concat(t);
            }
        });

        return tests;
    }

    /**
     * Deletes a file and all its tests from the index.
     * @param {string} file name of the file to delete
     */
    deleteFile(file: string): void {
        const fileName = basename(file);
        const nodeIds = this._filesNodeIdsIndex.get(fileName);

        if (nodeIds === undefined) {
            return;
        }

        nodeIds.forEach(n => this.delete(n));
        this.delete(fileName);
    }
}