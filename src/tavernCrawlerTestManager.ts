import { spawn } from 'child_process';
import { EventEmitter, once } from 'events';
import { XMLParser } from 'fast-xml-parser';
import { existsSync, mkdirSync, readFile } from 'fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative } from 'path';
import { promisify } from 'util';
import { LineCounter, parseAllDocuments } from 'yaml';
import { getExtensionCacheDirectory, getPytestPath } from './tavernCrawlerCommon';
import {
    TavernCrawlerTest,
    TavernTestType,
    TavernTestResult,
    TavernTestState
} from './tavernCrawlerTest';
import { TavernCrawlerTestsIndex } from './tavernCrawlerTestIndex';
import { TavernCrawlerTestsCache } from './tavernCrawlerTestsCache';
import { OutputChannel } from 'vscode';


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
                // skip the character of testName, but don't skip the character of the buffer, as
                // this still has to be compared with the testName.
            } else if (!invalidCharLine && invalidCharTestName) {
                i += 1;
            }
        }
    }

    return true;
};


export class TavernCrawlerTestManager {
    private _outputChannel: OutputChannel | undefined;
    private _testsCache: TavernCrawlerTestsCache;
    private _testsCacheFile: string;
    private _testsIndex = new TavernCrawlerTestsIndex();
    private _testsMainJunitFile: string;
    private _testsPath: string | undefined = undefined;
    private _workspaceCacheDirectory: string;
    private _workspaceId: string;
    private _globalVariables = new Map<string, Map<string, any>>();

    constructor(readonly workspacePath: string, public testsFolder?: string) {
        this._workspaceId = this._generateHash(this.workspacePath);
        this._workspaceCacheDirectory = join(getExtensionCacheDirectory(), this._workspaceId);
        this._testsMainJunitFile = join(this._workspaceCacheDirectory, this._workspaceId);
        this._testsCacheFile = join(this._workspaceCacheDirectory, `${this._workspaceId}.cache`);
        this._testsCache = new TavernCrawlerTestsCache(this._testsCacheFile);
        this._testsPath = join(this.workspacePath, testsFolder ?? '');

        if (!existsSync(this._workspaceCacheDirectory)) {
            mkdirSync(this._workspaceCacheDirectory, { recursive: true });
        }
    }

    set ouputChannel(channel: OutputChannel) {
        this._outputChannel = channel;
    }

    async deleteTestFiles(testFiles?: string[]): Promise<TavernCrawlerTestsIndex> {
        if (testFiles === undefined) {
            // Remove all test from the index a file(s) was/were not specified.
            this._testsIndex.clear();
        } else {
            // Remove old file from index and cache.
            for (const file of testFiles) {
                const testsToDelete = this._testsIndex.getTestsForFile(basename(file));
                testsToDelete.forEach(t => this._testsCache.delete(t.nodeId));
                this._testsIndex.deleteFile(file);
            }
        }

        return this._testsIndex;
    }

    private _generateHash(path: string): string;
    private _generateHash(test: TavernCrawlerTest): string;
    private _generateHash(obj: string | TavernCrawlerTest): string {
        const hash = createHash('md5');
        hash.update(obj instanceof TavernCrawlerTest ? obj.nodeId : obj);

        return hash.digest('hex');
    }

    private async _loadGlobalConfigurationVariables(files: string[] | string | undefined): Promise<void> {
        if (files === undefined
            || files === ''
            || Array.isArray(files) && files.length === 0) {
            return;
        }

        const readFileAsync = promisify(readFile);

        for (const file of files) {
            // Don't reload the file if it is already loaded.
            if (file in this._globalVariables) {
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
            if (fileName in this._globalVariables) {
                for (const [k, v] of documentVariables) {
                    this._globalVariables.get(fileName)?.set(k, v);
                }
            } else {
                this._globalVariables.set(fileName, documentVariables);
            }
        }
    }

    async loadTestFiles(testFiles: string[]): Promise<TavernCrawlerTestsIndex> {
        const readFileAsync = promisify(readFile);

        for (const file of testFiles) {
            const fileContent = await readFileAsync(file);
            const fileLocation = file;
            const filePath = dirname(file);

            // Parse the YAML documents in the file
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

                // Get the global variables that are referenced in this test. If the test file
                // doesn't include any file with global configurations, then don't do anything.
                if (includeFiles) {
                    await this._loadGlobalConfigurationVariables(includeFiles);

                    let testGlobalVariables = new Map<string, Map<string, any>>();
                    this._globalVariables.forEach((v: Map<string, any>, f: string) => {
                        if (f in includeFiles) {
                            testGlobalVariables.set(f, v);
                        }
                    });
                }

                let test = new TavernCrawlerTest(
                    jsDocument.test_name.trim(),
                    TavernTestType.Test,
                    fileLocation);
                test.relativeFileLocation = relative(this.workspacePath, fileLocation);
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
                                await this._resolveGlobalVariables(
                                    mark.parametrize.vals, includeFiles));
                        }
                    }
                }

                return test;
            }));

            this._testsIndex.addTest(tests);
        }

        return this._testsIndex;
    }

    async loadTestResults(resultFiles?: string[]): Promise<TavernCrawlerTestsIndex> {
        let index: TavernCrawlerTestsIndex = this._testsIndex;

        // Load the test files. If a file has been previously loaded, first delete the results from
        // the index an rebuild the index for the file. This avoids duplicate entries when calling 
        // loadTestFiles(), which doesn't look for (therefore, remove) duplicate entries. 
        if (resultFiles !== undefined) {
            for (const file of resultFiles) {
                index.forEach((test) => {
                    if (test.nodeId.startsWith(basename(file))) {
                        index.delete(test.nodeId);
                    }
                });
            }

            index = await this.loadTestFiles(resultFiles);
        }

        try {
            await this._testsCache.load();
        }
        catch (error) {
            /* TODO improve the handling of this exception. Maybe ignore the exception, since the
                    cache is empty, but still usable? */
            console.log(error);
        }

        return this._matchTestResults(index, this._testsCache);
    }

    private async _loadTestResultsFromJunit(junitFile: string): Promise<Map<string, TavernTestResult>> {
        // Documentation for JUnit here:
        // https://www.ibm.com/docs/en/developer-for-zos/14.1?topic=formats-junit-xml-format
        const parser = new XMLParser({ ignoreAttributes: false });
        let tests = new Map<string, TavernTestResult>();

        // Read the JUnit file.
        const readFileAsync = promisify(readFile);
        const fileContent = await readFileAsync(junitFile, 'utf-8');
        const xmlData = parser.parse(fileContent.toString());

        // Load the test results from the JUnit file. If only one test is executed, the result is a
        // single instance of a testcase, while multiple tests are an array of testcase obejcts.
        let testcases = Array.isArray(xmlData.testsuites.testsuite.testcase)
            ? xmlData.testsuites.testsuite.testcase
            : [xmlData.testsuites.testsuite.testcase];

        for (let testcase of testcases) {
            let failure: string | undefined = undefined;
            let state: TavernTestState = TavernTestState.Pass;

            if (testcase === undefined) {
                // If there aren't any testcases, then don't do anything, because nothing concrete 
                // can be assessed. This could be, for exmaple, the reuslt of not running the test.
                continue;
            } else if ('failure' in testcase) {
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

    private _matchTestResults(
        testsIndex: TavernCrawlerTestsIndex,
        testsCache: TavernCrawlerTestsCache,
        junitResults?: Map<string, TavernTestResult>): TavernCrawlerTestsIndex {

        for (const [nodeId, test] of testsIndex) {
            const testResult = junitResults?.get(nodeId) ?? testsCache.getResult(nodeId);

            if (testResult === undefined) {
                continue;
            }

            test.result = testResult;
            this._testsCache?.setResult(test);
        }

        return testsIndex;
    }

    private async _resolveGlobalVariables(variables: string[] | any[][], files: string[]): Promise<string[]> {
        let resolvedVariables: any[] = [];

        for (const variable of variables) {
            if (Array.isArray(variable)) {
                resolvedVariables.push(await this._resolveGlobalVariables(variable, files));
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
                        let variableFile = this._globalVariables.get(basename(file));
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
    async runTest(test: TavernCrawlerTest | IterableIterator<string>): Promise<TavernCrawlerTestsIndex | undefined> {
        let pythonPath = 'PYTHONPATH' in process.env
            ? `${process.env.PYTHONPATH}:${this._testsPath}`
            : this._testsPath;
        this._outputChannel?.appendLine(`${pythonPath}`);
        // eslint-disable-next-line @typescript-eslint/naming-convention
        let env = Object.assign(process.env, { 'PYTHONPATH': pythonPath });

        let junitFile: string = '';
        let args: string[] = [];

        if (test instanceof TavernCrawlerTest) {
            junitFile = `${this._workspaceCacheDirectory}/${this._generateHash(test)}`;
            args = [
                test.type === TavernTestType.File
                    ? `"${test.nodeId}"`
                    : `${dirname(test.fileLocation)}/"${test.nodeId}"`,
                `--junit-xml=${junitFile}`
            ];
        } else {
            junitFile = this._testsMainJunitFile;
            this._outputChannel!.appendLine(`this.workspacePath = ${this.workspacePath}`);
            args = [Array.from(test).join(" "), '-n', 'auto', `--junit-xml=${junitFile}`];
        }

        let pytestPath = getPytestPath();
        if (pytestPath === undefined) {
            throw new Error('Could not find pytest. Please verify that it is installed.');
        }

        this._outputChannel?.append(`${pytestPath} ${args.join(' ')}`);

        let tavernciFinished = new EventEmitter();
        let tavernciError: string | undefined = undefined;
        let tavernci = spawn(
            pytestPath,
            args,
            {
                // cwd: this.workspacePath,
                detached: false,
                shell: true,
                env: env
            }).on('error', (err) => {
                tavernciError = 'Failed to run the test. Please check that pytest is installed and '
                    + 'the configured tests folder (tavernCrawler.testsFolder) exists.';
                this._outputChannel?.appendLine(`error = ${err}`);
                tavernciFinished.emit('tavernci_finished');
            }).on('close', async (err) => {
                tavernciFinished.emit('tavernci_finished');
            }).on('exit', async (err) => {
                tavernciFinished.emit('tavernci_finished');
            });

        for await (const chunk of tavernci.stdout) {
            this._outputChannel?.append(`${chunk}`);
        }

        for await (const chunk of tavernci.stderr) {
            this._outputChannel?.append(`${chunk}`);
        }

        // Wait for the spawned process to finish. This avoids not finding the junitFile, which can
        // happen since spawn() runs asynchronously.
        await once(tavernciFinished, 'tavernci_finished');

        if (tavernciError !== undefined) {
            throw new Error(tavernciError);
        }

        let index = this._matchTestResults(
            this._testsIndex,
            this._testsCache,
            await this._loadTestResultsFromJunit(junitFile));

        await this._testsCache?.save();

        return index;
    }
}
