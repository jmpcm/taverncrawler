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
    Fail = 'fail',
    Pass = 'pass',
    Running = 'running',
    Skipped = 'skipped', // This state can occur when the test is marked as xfail, skip or skipif
    Unset = 'unset'
}

function calculateState(state0: TavernTestState, state1: TavernTestState): TavernTestState {
    // TODO the eavluation should always be to the worst case. the order is something like
            // 1. FAIL
            // 2. SKIP
            // 3. PASS
            // 4. UNSET
    // See set result() for more information.

    if (state0 === TavernTestState.Fail || state1 === TavernTestState.Fail) {
        return TavernTestState.Fail;
    } else if (state0 === TavernTestState.Running || state1 === TavernTestState.Running) {
        return TavernTestState.Running;
    } else if (state0 !== TavernTestState.Unset && state1 === TavernTestState.Unset) {
        return state0;
    } else if (state0 === TavernTestState.Unset && state1 !== TavernTestState.Unset) {
        return state1;
    } else if (state0 === TavernTestState.Pass && state1 !== TavernTestState.Pass
        || state0 === TavernTestState.Skipped && state1 !== TavernTestState.Skipped) {
        return state1;
    } else if (state0 === state1) {
        return state0;
    }

    return state0;
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
    readonly description: string = '';
    fileLine: number = 1;
    // private globalVariables = new Map<string, any>();
    private _nodeId: string; // pytest's nodeId. The ID usually has the format <filename>::<testname>.
    public parentTest?: TavernTest = undefined;
    // private otherMarks: string[] = [];
    private _childrenTests: TavernTest[] = [];
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
            state: TavernTestState.Unset
        };
        this.fileName = fileName;
        this._nodeId = this.type === TavernTestType.File
            ? `${this.fileName}`
            : `${this.fileName}::${name}`;
    }

    get childrenTests(): TavernTest[] {
        return this._childrenTests;
    }

    get nodeId(): string {
        return this._nodeId;
    }

    get stages(): TavernTestStage[] {
        return this._stages;
    };

    get result(): TavernTestResult {
        return this._result;
    }

    set result(result: TavernTestResult) {
        this._result = result;
        this.result.state = this.evaluateState();

        if (this.parentTest !== undefined) {

            // TODO the eavluation should always be to the worst case. the order is something like
            // 1. FAIL
            // 2. SKIP
            // 3. PASS
            // 4. UNSET


            this.parentTest.result = {
                name: '',
                failure: undefined,
                // state: calculateState(this.parentTest.result.state, this.result.state)
                state: calculateState(this.parentTest.evaluateState(), this.result.state)
            };
        }
    }

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

        if (this._childrenTests.length === 0) {
            for (let param of parameters) {
                let name = Array.isArray(param) ? param.join('-') : param.toString();

                let paramTest = new TavernTest(
                    name,
                    TavernTestType.ParameterTest,
                    this.fileName);
                paramTest.fileLine = this.fileLine;
                paramTest.parentTest = this;

                this._childrenTests.push(paramTest);
            }
        } else {
            // The test already has parameters, thus merge these with the new ones. Tavern names
            // parameter tests by joining all parameters, separated by an hifen.
            let newTestNameParameters: TavernTest[] = [];

            for (let testNameParam of parameters) {
                newTestNameParameters.push.apply(
                    newTestNameParameters,
                    this._childrenTests.map(t => {
                        let paramTest = new TavernTest(
                            `${t.name}-${testNameParam.toString()}`,
                            TavernTestType.ParameterTest,
                            this.fileName);
                        paramTest.fileLine = this.fileLine;
                        paramTest.parentTest = this;

                        return paramTest;
                    }
                    ));
            }

            this._childrenTests.length = 0;
            this._childrenTests = newTestNameParameters;
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
        this._childrenTests.push.apply(
            this._childrenTests,
            Array.isArray(tests) ? tests : [tests]);
    }

    /**
     * Recursively evaluate the state of a test. This will occur for tests that are either a file,
     * or have parameters to evalute.
     * 
     * @param {TavernTestTreeItem[]} children - array of tests to be evaluated
     * @returns the current state of the test
     */
    private evaluateState(children?: TavernTest[] | undefined): TavernTestState {
        if (children === undefined || children.length === 0) {
            return this._result.state;
        }

        let state = this._result.state;

        for (const child of children) {
            if (child._childrenTests.length > 0) {
                state = this.evaluateState(child._childrenTests);
            }

            state = calculateState(state, child.result.state);
        }

        return state;
    }
}
