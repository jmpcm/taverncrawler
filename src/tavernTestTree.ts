import { TavernTest, TavernTestType } from './tavernTest';


export class TavernTestTree extends Map<string, TavernTest> {
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

    setTest(test: TavernTest | TavernTest[]): void {
        if (test === undefined) {
            throw new Error("test object can't be undefined");
        }

        let testsToAppend = test instanceof TavernTest ? [test] : test;

        testsToAppend.forEach(test => {
            let fileTest = this.get(test.fileName)
                ?? new TavernTest(test.fileName, TavernTestType.File, test.fileName);

            if (!this.has(fileTest.nodeId)) {
                this.set(fileTest.nodeId, fileTest);
            }

            if (test.type === TavernTestType.Test) {
                test.parentTest = fileTest;
                fileTest.addTests(test);
                test.childrenTests.forEach(child => this.setTest(child));
            }

            this.set(test.nodeId, test);
        });
    }
}