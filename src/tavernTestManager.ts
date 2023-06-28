import { spawn } from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import { existsSync, mkdirSync, readFile } from 'fs';
import { createHash } from 'node:crypto';
import { platform } from 'node:process';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { promisify } from 'util';
import { LineCounter, parseAllDocuments } from 'yaml';
import { TavernTest, TavernTestType, TavernTestResult, TavernTestState } from './tavernTest';
import { TavernTestCache } from './tavernTestCache';
import { TavernTestIndex } from './tavernTestIndex';


/** 
 * Assert if the test is the same, by comparing its name. The strings are compared withoutht spaces
 * and newlines, making it very likely that the test is the same. If the current buffer line is not
 * a test name, i.e. it doesn't start with 'test_name', then it is assumed that line is not a test.
 * 
 * @param {Buffer} line - current line in the buffer being traversed, that will be compared against
 *                 the test name
 * @param {string} testName - current test to check te name
 * @returns {boolean} true if the test name is the same; false otherwise
 */
function isSameTest(line: Buffer, testName: string): boolean {
    if (line.slice(0, 9).toString() !== 'test_name') {
        return false;
    }

    // Start in character 12 of the testName, t oavoid the prefix 'test_name: '.
    for (let i = 0, j = 12; i < testName.length; i++, j++) {
        let invalidCharTestName: boolean = [' ', '\n'].includes(testName[i]);
        let invalidCharLine: boolean = [0x20, 0x0a].includes(line[j]);

        if (!invalidCharTestName && !invalidCharLine) {
            if (testName.charCodeAt(i) !== line[j]) {
                return false;
            }
        } else {
            // The current character in testName is a newline. Tavern removes new lines from the 
            // testName, so these must be skipped.
            if (invalidCharLine && !invalidCharTestName) {
                j += 1;
                i -= 1;
                // The current character in the testName is invalid (most likely a space). Therefore,
                // skip the character of testName, but don't skip the character of the buffer, as this
                // still has to be compared with the testName.
            } else if (!invalidCharLine && invalidCharTestName) {
                i += 1;
            }
        }
    }

    return true;
};


export class TavernTestManager {
    private _testsCache: TavernTestCache | undefined = undefined;
    private _testsIndex = new TavernTestIndex();
    private _testsMainJunitFile: string;
    private _testsResultsPath: string = '/var/tmp/tavern-crawler';
    private _testsWorkspaceId: string;
    private globalVariables = new Map<string, Map<string, any>>();

    constructor(readonly testsPath: string) {
        this.testsPath = testsPath;

        if (platform === 'darwin') {
            this._testsResultsPath = `${homedir()}/Library/Caches/tavern-crawler`;
        } else if (platform === 'linux' || platform === 'openbsd' || platform === 'freebsd') {
            this._testsResultsPath = `${homedir()}/.tavern-crawler`;
        } else if (platform === 'win32') {
            this._testsResultsPath = `${process.env.APPDATA}/tavern-crawler`;
        }

        this._testsWorkspaceId = this.generateHash(this.testsPath);
        this._testsResultsPath = join(this._testsResultsPath, this._testsWorkspaceId);
        this._testsMainJunitFile = join(this._testsResultsPath, this._testsWorkspaceId);

        if (!existsSync(this._testsResultsPath)) {
            mkdirSync(this._testsResultsPath);
        }
    }

    async getTests(): Promise<TavernTestIndex | undefined> {
        return await this.runTest();
    }

    private async loadGlobalConfigurationVariables(files: string[] | string | undefined): Promise<void> {
        if (files === undefined
            || files === ''
            || Array.isArray(files) && files.length === 0) {
            return;
        }

        const readFileAsync = promisify(readFile);

        for (const file of files) {
            // Don't reload the file if it is already loaded.
            if (file in this.globalVariables) {
                continue;
            }

            const fileContent = await readFileAsync(file, 'utf-8');
            const documents = parseAllDocuments(fileContent);
            let documentVariables = new Map<string, any>();

            documents.map(document => {
                const jsDocument = document.toJS();

                for (const [k, v] of Object.entries(jsDocument.variables) ?? {}) {
                    documentVariables.set(k, v);
                }
            });

            const fileName = basename(file);
            if (fileName in this.globalVariables) {
                for (const [k, v] of documentVariables) {
                    this.globalVariables.get(fileName)?.set(k, v);
                }
            } else {
                this.globalVariables.set(fileName, documentVariables);
            }
        }
    }

    async loadTestFiles(testFiles: string[]): Promise<TavernTestIndex> {
        for (let file of testFiles) {
            const readFileAsync = promisify(readFile);
            const fileContent = await readFileAsync(file);
            const fileName = basename(file);
            const filePath = dirname(file);

            // Parse the YAML documents
            let lineCounter = new LineCounter();
            let testDocuments = parseAllDocuments(
                fileContent.toString(),
                { lineCounter: lineCounter });

            // Build the test objects
            let lastTestsFoundIndex = 0;
            let tests = await Promise.all(testDocuments.map(async document => {
                const jsDocument = document.toJS();
                const includeFiles = jsDocument.includes?.map(
                    (f: string) => join(filePath, f)) ?? undefined;

                await this.loadGlobalConfigurationVariables(includeFiles);

                // Get the global variables that are referenced in this test.
                let testGlobalVariables = new Map<string, Map<string, any>>();
                this.globalVariables.forEach((v: Map<string, any>, f: string) => {
                    if (f in includeFiles) {
                        testGlobalVariables.set(f, v);
                    }
                });

                let test = new TavernTest(jsDocument.test_name.trim(), TavernTestType.Test, fileName);
                test.addStages(jsDocument.stages);
                // test.addGlobalVariables(testGlobalVariables);

                // Discover the line where the test is placed. The search starts after the last test
                // index found, since these are in order.
                // This operation is performed before setting the marks, because addParameters()
                // will set fileLine of any parameter tests, to the file line of the parent test.
                for (let i = lastTestsFoundIndex; i < lineCounter.lineStarts.length; i++) {
                    let lineStart = lineCounter.lineStarts[i];

                    if (isSameTest(fileContent.slice(lineStart), test.name)) {
                        test.fileLine = lineCounter.linePos(lineStart).line;
                        lastTestsFoundIndex = i;
                        break;
                    }
                }

                // The test has parameters, which indicates that the test will have "sub-tests",
                // i.e. a test for combinations of parameters.
                if ('marks' in jsDocument) {
                    for (let mark of jsDocument.marks) {
                        if (typeof mark === 'object' && 'parametrize' in mark) {
                            test.addParameters(
                                await this.resolveGlobalVariables(
                                    mark.parametrize.vals, includeFiles));
                        }
                    }
                }

                return test;
            }));

            this._testsIndex.setTest(tests);
        }

        return this._testsIndex;
    }

    async loadTestResults(testFiles?: string[]): Promise<TavernTestIndex> {
        let index: TavernTestIndex = this._testsIndex;

        // Load the test files. If a file has been previously loaded, first delete the results from
        // the index an rebuild the index for the file. This avoids duplicate entries when calling 
        // loadTestFiles(), which doesn't look for (therefore, remove) duplicate entries. 
        if (testFiles !== undefined) {
            for (let file of testFiles) {
                index.forEach((test) => {
                    if (test.nodeId.startsWith(basename(file))) {
                        index.delete(test.nodeId);
                    }
                });
            }

            index = await this.loadTestFiles(testFiles);
        }

        // Load the cache
        this._testsCache = await this.loadTestsCache();

        // Load the JUnit file and match the results
        if (existsSync(this._testsMainJunitFile)) {
            let junitResults = await this.loadTestResultsFromJunit(this._testsMainJunitFile);

            return this.matchTestResults(index, junitResults);
        } else {
            return index;
        }
    }

    private async loadTestResultsFromJunit(resultsFile: string): Promise<Map<string, TavernTestResult>> {
        // Documentation for JUnit here:
        // https://www.ibm.com/docs/en/developer-for-zos/14.1?topic=formats-junit-xml-format
        const parser = new XMLParser({ ignoreAttributes: false });
        let tests = new Map<string, TavernTestResult>();

        // Read the JUnit file.
        const readFileAsync = promisify(readFile);
        const fileContent = await readFileAsync(resultsFile, 'utf-8');
        const xmlData = parser.parse(fileContent.toString());

        // Load the test results from the JUnit file. If only one test is executed, the result is a
        // single instance of a testcase, while multiple tests are an array of testcase obejcts.
        let testcases = Array.isArray(xmlData.testsuites.testsuite.testcase)
            ? xmlData.testsuites.testsuite.testcase
            : [xmlData.testsuites.testsuite.testcase];

        for (let testcase of testcases) {
            let failure: string | undefined = undefined;
            let state: TavernTestState = TavernTestState.Pass;

            if ('failure' in testcase) {
                failure = testcase.failure['#text'];
                state = TavernTestState.Fail;
            } else if ('skipped' in testcase) {
                failure = testcase.skipped['#text'];
                state = TavernTestState.Skipped;
            }

            let junitTest: TavernTestResult = {
                name: `${testcase['@_classname']}::${testcase['@_name']}`,
                failure: failure,
                state: state
            };

            tests.set(junitTest.name, junitTest);
        }

        return tests;
    }

    private async loadTestsCache(): Promise<TavernTestCache> {
        const cache = await TavernTestCache.fromFile(
            `${this._testsResultsPath}/tests_cache.json`);

        return cache ?? new TavernTestCache();
    }

    private matchTestResults(
        tavernTests: TavernTestIndex,
        junitResults: Map<string, TavernTestResult>): TavernTestIndex {

        for (let [testId, testJunitResult] of junitResults) {
            let test = tavernTests.getTest(testId);

            if (test === undefined) {
                continue;
            }

            test.result = testJunitResult;

            // Set the results for the parameter tests.
            if (test.type === TavernTestType.Test && test.childrenTests.length > 0) {
                for (let paramTest of test.childrenTests) {
                    let paramTestJunitResult = junitResults.get(`${test.name}[${paramTest.name}]`);

                    if (paramTestJunitResult !== undefined) {
                        paramTest.result = paramTestJunitResult;
                    }
                }
            }
        }

        return tavernTests;
    }

    private async resolveGlobalVariables(variables: string[] | any[][], files: string[]): Promise<string[]> {
        let resolvedVariables: any[] = [];

        for (const variable of variables) {
            if (Array.isArray(variable)) {
                resolvedVariables.push(await this.resolveGlobalVariables(variable, files));
            } else if (typeof variable !== 'string') {
                resolvedVariables.push(variable);
            } else {
                const start = variable.indexOf('{');

                if (start > -1) {
                    const end = Math.min(variable.indexOf('}'), variable.indexOf(':'));
                    // An } was not found. Therefore, assume that a variable is not defined and return.
                    if (end < 0) {
                        continue;
                    }
                    const variableKey = variable.substring(start + 1, end);

                    let variableValue = undefined;
                    for (const file of files) {
                        let variableFile = this.globalVariables.get(basename(file));
                        variableValue = variableFile?.get(variableKey);
                        if (variableValue !== undefined) {
                            break;
                        }
                    }

                    if (variableValue === undefined) {
                        throw new Error(`The variable ${variableKey} could not be resolved`);
                    }
                    resolvedVariables.push(variableValue);
                } else {
                    resolvedVariables.push(variable);
                }
            }
        }

        return resolvedVariables;
    }

    /**
     * Run a test, or a set of tests.
     * @param test 
     * @returns 
     */
    async runTest(test?: TavernTest): Promise<TavernTestIndex> {
        let pythonPath = 'PYTHONPATH' in process.env
            ? `${process.env.PYTHONPATH}:${this.testsPath}`
            : this.testsPath;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        let env = Object.assign(process.env, { 'PYTHONPATH': pythonPath });

        let junitFile = '';
        let args: string[] = [];

        if (test !== undefined) {
            junitFile = `${this._testsResultsPath}/${this.generateHash(test)}`;
            args = [`"${test.nodeId}"`, `--junit-xml=${junitFile}`];
        } else {
            junitFile = this._testsMainJunitFile;
            args = [this.testsPath, `--junit-xml=${junitFile}`];
        }

        let tavernci = spawn(
            '/usr/local/bin/pytest',
            args,
            {
                cwd: this.testsPath,
                detached: false,
                shell: true,
                env: env
            });

        let data = "";
        for await (const chunk of tavernci.stdout) {
            data += chunk;
        }

        let error = "";
        for await (const chunk of tavernci.stderr) {
            error += chunk;
        }

        return this.matchTestResults(this._testsIndex, await this.loadTestResultsFromJunit(junitFile));
    }

    private generateHash(path: string): string;
    private generateHash(test: TavernTest): string;
    private generateHash(obj: string | TavernTest): string {
        const hash = createHash('md5');
        hash.update(obj instanceof TavernTest ? obj.nodeId : obj);

        return hash.digest('hex');
    }
}
