export enum TavernStageType {
    HTTP = 'http',
    MQTT = 'mqtt'
}


export enum TavernTestType {
    File = 'file',
    None = 'none',
    ParameterTest = 'parameterTest',
    Test = 'test'
}


export enum TavernTestState {
    Fail = 0x80,
    Skipped = 0x40,// This state can occur when the test is marked as xfail, skip or skipif
    Unset = 0x20,
    Pass = 0x10,
    FailCached = Fail >> 4,
    SkippedCached = Skipped >> 4,
    PassCached = Pass >> 4,
    Running = 0
}

export function getCachedState(state: TavernTestState): TavernTestState {
    if (state === TavernTestState.Unset
        || state === TavernTestState.Running
        || state < TavernTestState.Pass) {
        return state;
    }

    return state >> 4;
}

export interface TavernTestResult {
    failure: string | undefined;
    name: string;
    state: TavernTestState;
}


export interface TavernTestStage {
    name: string;
    type: TavernStageType;
    request: Record<string, any> | undefined;
    response: Record<string, any> | undefined;
    mqttPublish: Record<string, any> | undefined;
    mqttResponse: Record<string, any> | undefined;
}


export class TavernTest {
    static DEFAULT_STATE: TavernTestState = TavernTestState.Unset;
    readonly description: string = '';
    fileLine: number = 1;
    // private globalVariables = new Map<string, any>();
    private _nodeId: string; // pytest's nodeId. The ID usually has the format <filename>::<testname>.
    public _parentTest: TavernTest | undefined = undefined;
    // private otherMarks: string[] = [];
    private _childrenTests = new Map<string, TavernTest>();
    private _result: TavernTestResult;
    private _stages: TavernTestStage[] = [];
    // private _parameters: string[] = [];

    constructor(
        readonly name: string,
        readonly type: TavernTestType,
        public fileName: string,
    ) {
        this.type = type;
        this.name = name;
        this._result = {
            failure: undefined,
            name: '',
            state: TavernTest.DEFAULT_STATE
        };
        this.fileName = fileName;

        this._nodeId = this.type === TavernTestType.File
            ? `${this.fileName}`
            : `${this.fileName}::${name}`;
    }

    get childrenTests(): TavernTest[] {
        return Array.from(this._childrenTests.values());
    }

    get nodeId(): string {
        return this._nodeId;
    }

    get parentTest(): TavernTest | undefined {
        return this._parentTest;
    }

    set parentTest(test: TavernTest | undefined) {
        this._parentTest = test;
        if (this._parentTest !== undefined && this.type === TavernTestType.ParameterTest) {
            this._nodeId = `${this.fileName}::${this._parentTest.name}[${this.name}]`;
        }
    }

    get result(): TavernTestResult {
        return this._result;
    }

    set result(result: TavernTestResult) {
        this._result = result;
        this.result.state = this.evaluateState();

        if (this._parentTest !== undefined) {
            this._parentTest.result = {
                name: '',
                failure: undefined,
                state: this._parentTest.evaluateState()
            };
        }
    }

    get stages(): TavernTestStage[] {
        return this._stages;
    };

    /**
     * Add global variables to the test. The test can later resolve any variables when adding stages
     * or parameters to it.
     * 
     * @param {Map<string, any>} variables - a map with strings with the variable names and its values
     */
    // addGlobalVariables(variables: Map<string, any>): void {
    //     for (const [k, v] of variables) {
    //         this.globalVariables.set(k, v);
    //     }
    // }

    /**
     * Add test parameters. These are defined in the marks section of a test, using the parametrize
     * keyword, in the marks. The function creates the combiantions of parameters, like Tavern does,
     * so that these can later be used to create the name of the test. In additon, any global
     * variable is also resolved.
     *
     * @param {any[]} parameters - list of parameters to add
     */
    addParameters(parameters: any[]): void {
        if (this.type !== TavernTestType.Test) {
            throw new Error(`parameters can only be added to tests of type Test (this is ${this.type})`);
        }

        if (this._childrenTests.size === 0) {
            for (let param of parameters) {
                let name = Array.isArray(param) ? param.join('-') : param.toString();

                let paramTest = new TavernTest(
                    `${name}`,
                    TavernTestType.ParameterTest,
                    this.fileName);
                paramTest.fileLine = this.fileLine;
                paramTest.parentTest = this;

                this._childrenTests.set(paramTest.nodeId, paramTest);
            }
        } else {
            // If the test already has parameters, then merge these with the new ones. Tavern
            // parameter tests named are formed by joining all parameters, separated by an hifen.
            let newTestNameParameters: TavernTest[] = [];

            for (let testNameParam of parameters) {
                newTestNameParameters.push.apply(
                    newTestNameParameters,
                    Array.from(this._childrenTests).map(([testNodeId, test]) => {
                        let paramTest = new TavernTest(
                            `${test.name}-${testNameParam.toString()}`,
                            TavernTestType.ParameterTest,
                            this.fileName);
                        paramTest.fileLine = this.fileLine;
                        paramTest.parentTest = this;

                        return paramTest;
                    }
                    ));
            }

            this._childrenTests = new Map<string, TavernTest>(
                newTestNameParameters.map(t => [t.nodeId, t]));
        }
    }

    /**
     *
     * @param stages
     */
    addStages(stages: TavernTestStage[] | any): void {
        this._stages.push.apply(stages);
    }

    /**
     * 
     * @param tests 
     */
    addTests(tests: TavernTest[] | TavernTest): void {
        for (const test of Array.isArray(tests) ? tests : [tests]) {
            this._childrenTests.set(test.nodeId, test);
        }
    }

    /**
     * Recursively evaluate the state of a test. This will occur for tests that are either a file,
     * or have parameters to evalute.
     * 
     * @param {TavernTestTreeItem[]} children - array of tests to be evaluated
     * @returns the current state of the test
     */
    private evaluateState(children?: TavernTest[] | undefined): TavernTestState {
        let childrenToEvaluate = children === undefined ? this.childrenTests : children;

        if (childrenToEvaluate.length === 0) {
            return this._result.state;
        }

        let state = childrenToEvaluate.at(0)?.result.state ?? TavernTest.DEFAULT_STATE;

        for (const child of childrenToEvaluate) {
            if (child._childrenTests.size > 0) {
                child.evaluateState();
            }

            state = state <= child.result.state ? child.result.state : state;
        }

        return state;
    }
}
