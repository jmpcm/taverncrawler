import { TavernTest, TavernTestType } from './tavernTest';


export class TavernTestTree extends Map<string, Map<string, TavernTest>> {
    private fileTests = new Map<string, TavernTest>();

    addTest(test: TavernTest): void;
    addTest(fileName: string, tests: TavernTest[]): void;
    addTest(filenameOrTest: string | TavernTest, tests?: TavernTest[]): void {
        if (filenameOrTest === undefined || filenameOrTest === '') {
            throw new Error("test object or name can't be undefined or empty");
        }

        let fileName = typeof filenameOrTest === 'string' ? filenameOrTest : filenameOrTest.fileName;
        const testsToAppend = tests !== undefined ? tests : [filenameOrTest as TavernTest];

        if (fileName in this) {
            const file = this.get(fileName);
            const fileTest = this.fileTests.get(fileName);

            for (const test of testsToAppend) {
                test.parentTest = fileTest;
                file!.set(test.name, test);
            }
        } else {
            const fileTest = new TavernTest(fileName, TavernTestType.File, fileName);

            fileTest.addTests(testsToAppend);
            this.fileTests.set(fileName, fileTest);

            this.set(fileName, new Map<string, TavernTest>(testsToAppend.map((t: TavernTest) => {
                t.parentTest = fileTest;
                return [t.name, t];
            })));
        }
    }

    getTest(test: TavernTest): TavernTest | undefined;
    getTest(fileName: string, nodeId?: string): TavernTest | undefined;
    getTest(fileNameOrTest: string | TavernTest, nodeId?: string): TavernTest | undefined {
        // Overload getTest(fileName: string, nodeId: string): TavernTest | undefined;
        if (typeof fileNameOrTest === 'string' && nodeId !== undefined) {
            return this.get(fileNameOrTest)?.get(nodeId);
        } else if (typeof fileNameOrTest === 'string' && nodeId === undefined) {
            return this.fileTests.get(fileNameOrTest);
        }

        // Overload getTest(test: TavernTest): TavernTest | undefined;
        if (fileNameOrTest instanceof TavernTest) {
            if (fileNameOrTest.type === TavernTestType.File) {
                return this.fileTests.get(fileNameOrTest.fileName);
            }

            return this.get(fileNameOrTest.fileName)?.get(fileNameOrTest.name);
        }
    }
}
