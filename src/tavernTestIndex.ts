import { basename } from 'path';
import { TavernTest, TavernTestType } from './tavernTest';


export class TavernTestIndex extends Map<string, TavernTest> {
    private _filesNodeIdsIndex = new Map<string, Set<string>>();

    addTest(test: TavernTest | TavernTest[]): void {
        if (test === undefined) {
            throw new Error("test object can't be undefined");
        }

        let testsToAppend = test instanceof TavernTest ? [test] : test;

        testsToAppend.forEach(test => {
            let fileTest = this.get(test.fileLocation);

            if (fileTest === undefined) {
                fileTest = new TavernTest(
                    basename(test.fileLocation),
                    TavernTestType.File,
                    test.fileLocation);
                fileTest.relativeFileLocation = test.relativeFileLocation ?? '';
            }

            if (!this.has(fileTest.nodeId)) {
                this.set(fileTest.nodeId, fileTest);
            }

            if (test.type === TavernTestType.Test) {
                test.parentTest = fileTest;
                fileTest.addTests(test);
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

    filter(type: TavernTestType): TavernTest[] {
        let results: TavernTest[] = [];

        this.forEach((test, _) => {
            if (test.type === type) {
                results.push(test);
            }
        });

        return results;
    }

    getTest(test: TavernTest): TavernTest | undefined;
    getTest(nodeId: string): TavernTest | undefined;
    getTest(testOrNodeId: string | TavernTest | TavernTestType): TavernTest | TavernTest[] | undefined {
        return this.get(testOrNodeId instanceof TavernTest ? testOrNodeId.nodeId : testOrNodeId);
    }

    getTestsForFile(file: string): TavernTest[] {
        const nodeIds = this._filesNodeIdsIndex.get(file);
        let tests: TavernTest[] = [];

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