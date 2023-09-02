import { basename, join, relative, sep } from "path";
import { TavernCrawlerTest, TavernTestType } from "./tavernCrawlerTest";

export class TavernCrawlerTestsFactory {
    constructor(
        readonly workspacePath: string,
        public testsDirectory: string | undefined,
        public commonDirectoryPath?: string) {
    }

    create(type: TavernTestType, name: string, fileLocation: string, parent?: TavernCrawlerTest): TavernCrawlerTest {
        let test: TavernCrawlerTest;

        if (type === TavernTestType.Test) {
            test = new TavernCrawlerTest(name, type, fileLocation);
            test.nodeId = `${this._calculateNodeIdPath(fileLocation)}::${name}`;
            test.relativeFileLocation = relative(this.workspacePath, fileLocation);
        } else if (type === TavernTestType.ParameterTest) {
            if (parent === undefined) {
                throw new Error('A parent test was not specified');
            }

            test = new TavernCrawlerTest(
                name,
                TavernTestType.ParameterTest,
                parent.fileLocation);
            test.nodeId = `${parent.nodeId}[${name}]`;
            test.fileLine = parent!.fileLine;
            test.parentTest = parent;
        } else if (type === TavernTestType.File) {
            if (parent === undefined) {
                throw new Error('A parent test was not specified');
            }

            test = new TavernCrawlerTest(
                basename(fileLocation),
                TavernTestType.File,
                fileLocation);
            test.nodeId = fileLocation;
            test.relativeFileLocation = relative(this.workspacePath, fileLocation);
        } else {
            throw new Error(`Unknown test type ${type}`);
        }

        return test;
    }

    private _calculateNodeIdPath(testPath: string): string {
        if (this.commonDirectoryPath === undefined) {
            return '';
        }

        const testPathTokens = testPath.split(sep);
        const commonDirectoryPathTokens = this.commonDirectoryPath.split(sep);

        let i = 0;
        for (; i < Math.min(testPathTokens.length, commonDirectoryPathTokens.length); i++) {
            if (testPathTokens[i] !== commonDirectoryPathTokens[i]) {
                break;
            }
        }

        return i !== testPathTokens.length ? testPathTokens.slice(i).join('.') : '';
    }
}