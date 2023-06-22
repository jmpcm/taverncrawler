import { basename, join } from 'path';
import {
    Event,
    EventEmitter,
    ExtensionContext,
    MarkdownString,
    Position,
    ProviderResult,
    Range,
    TextEditorRevealType,
    ThemeColor,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    Uri,
    window,
    workspace,
    DecorationRangeBehavior,
    DecorationOptions,
    TextEditorDecorationType,
    TextEditor,
    TextDocument
} from 'vscode';
import { TavernTestManager } from './tavernTestManager';
import { TavernTest, TavernTestState, TavernTestType } from './tavernTest';


const testStatIcons: Record<TavernTestState, ThemeIcon> = {
    [TavernTestState.Fail]: new ThemeIcon('error', new ThemeColor('testing.iconFailed')),
    [TavernTestState.Pass]: new ThemeIcon('pass', new ThemeColor('testing.iconPassed')),
    [TavernTestState.Running]: new ThemeIcon('loading~spin'),
    [TavernTestState.Skipped]: new ThemeIcon('remote-explorer-review-issues',
        new ThemeColor('tavernTracker.test.skipped.icon')),
    [TavernTestState.Unset]: new ThemeIcon('circle-large-outline',
        new ThemeColor('testing.iconUnset'))
};

function applyIconToTreeItems(items: TavernTestTreeItem[], icon?: ThemeIcon): void {
    for (let item of items) {
        item.iconPath = icon !== undefined ? icon : getIcon(item.test.result.state);

        if (item.children.length > 0) {
            applyIconToTreeItems(item.children, icon);
        }
    }
}

function getIcon(state: TavernTestState): ThemeIcon {
    return testStatIcons[state];
}

class DecorationsMap {
    private decorators = new Map<string, Map<number, TextEditorDecorationType>>();

    private static buildDecoration(test: TavernTest): TextEditorDecorationType {
        switch (test.result.state as TavernTestState) {
            case TavernTestState.Fail:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: new ThemeColor('testing.message.error.lineBackground'),
                        border: 'solid',
                        borderWidth: '1px',
                        borderColor: new ThemeColor('testing.peekBorder'),
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "fail.svg"),
                        gutterIconSize: 'contain',
                        isWholeLine: true,
                        overviewRulerColor: new ThemeColor('testing.message.error.lineBackground'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
            case TavernTestState.Skipped:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: new ThemeColor('tavernTracker.test.skipped.backgroundColor'),
                        border: 'solid',
                        borderWidth: '1px',
                        borderColor: new ThemeColor('tavernTracker.test.skipped.border'),
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "skipped.svg"),
                        gutterIconSize: 'contain',
                        isWholeLine: true,
                        overviewRulerColor: "#fbc02d80",
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
                    });
            case TavernTestState.Pass:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: undefined,
                        border: undefined,
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "pass.svg"),
                        gutterIconSize: 'contain',
                        overviewRulerColor: new ThemeColor('testing.iconPassed'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
            case TavernTestState.Unset:
            default:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: undefined,
                        border: undefined,
                        gutterIconPath: join(__filename, "..", "..", "resources", "light", "undefined.svg"),
                        gutterIconSize: 'contain',
                        overviewRulerColor: new ThemeColor('testing.iconUnset'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
        }
    }

    setDecoration(editor: TextEditor, item: TavernTestTreeItem): void {
        const file = basename(editor.document.fileName);
        const newDecoration = DecorationsMap.buildDecoration(item.test);

        if (this.decorators.has(file)) {
            let lines = this.decorators.get(file);
            const oldDecoration = lines?.get(item.test.fileLine);

            // Clear the old decorator...
            if (oldDecoration !== undefined) {
                editor.setDecorations(oldDecoration, []);
            }
            // ... and set the new one
            lines?.set(item.test.fileLine, newDecoration);
        } else {
            this.decorators.set(file, new Map([[item.test.fileLine, newDecoration]]));
        }

        editor.setDecorations(newDecoration!, [item.decorationOptions!]);
    }
}

export class TavernTrackerProvider implements TreeDataProvider<TavernTestTreeItem> {
    // This structure stores the file name (string) and a set witl all the file lines (number) that 
    // have been decorated. This way, when its time to decide if the line must be decorated, this 
    // structure can be used to do this assertion.
    private decoratorsMap = new DecorationsMap();
    private _onDidChangeTreeData = new EventEmitter<TavernTestTreeItem | undefined>();
    readonly onDidChangeTreeData?: Event<TavernTestTreeItem | undefined> =
        this._onDidChangeTreeData.event;
    private readonly _testsManager: TavernTestManager;
    private _treeNodes: TavernTestTreeItem[] = [];
    private _workspaceTavernFiles = new Map<string, Uri>();


    constructor(private context: ExtensionContext) {
        const workspacePath = workspace.workspaceFolders && workspace.workspaceFolders.length > 0
            ? workspace.workspaceFolders[0].uri.fsPath
            : "undefined";

        this._testsManager = new TavernTestManager(workspacePath);
    }



    private async discoverTavernTestFiles(): Promise<Map<string, Uri>> {
        let files = await workspace.findFiles('**.tavern.yaml');

        return this._workspaceTavernFiles = new Map<string, Uri>(
            files.map(f => [basename(f.fsPath), f])
        );
    }

    getChildren(element?: TavernTestTreeItem): ProviderResult<TavernTestTreeItem[]> {
        if (element) {
            return Promise.resolve(element.children);
        }

        return Promise.resolve(this._treeNodes);
    }

    private async decorateFile(editor: TextEditor): Promise<void> {
        let document = editor.document;
        let node = this._treeNodes.find(n => n.test.fileName === basename(document.fileName));

        for (const child of node?.children!) {
            this.decoratorsMap.setDecoration(editor, child);
        }
    }

    getTreeItem = (node: TavernTestTreeItem) => node;

    async goToTest(item: TavernTestTreeItem): Promise<void> {
        if (item.test.fileName === undefined) {
            return;
        }

        let tavernTestFile = this._workspaceTavernFiles.get(item.test.fileName);

        if (tavernTestFile === undefined) {
            return;
        }

        let document = await workspace.openTextDocument(tavernTestFile!);
        let editor = await window.showTextDocument(document);
        let startPos: Position;
        let endPos: Position;

        if (item.test.type === TavernTestType.File) {
            startPos = new Position(0, 0);
            endPos = new Position(0, 0);

            this.decorateFile(editor);
        } else {
            startPos = new Position(item.test.fileLine - 1, 0);
            endPos = new Position(item.test.fileLine - 1, 1024);

            this.decoratorsMap.setDecoration(editor, item);
        }

        editor.revealRange(new Range(startPos, endPos), TextEditorRevealType.InCenter);
    }

    async refresh() {
        // If the tests were previsouly loaded, then clear the tree first, otherwise the tests will
        // appear duplicated.
        this._treeNodes.length = 0;

        const testFiles = await this.discoverTavernTestFiles();
        // this._testsManager.addTestFiles(Array.from(testFiles.values()).map(t => t.fsPath));
        await this._testsManager.loadTestFiles(Array.from(testFiles.values()).map(t => t.fsPath));

        let tests = await this._testsManager.loadTestResults();

        for (let [file, fileTests] of tests) {
            let treeItem = new TavernTestTreeItem(tests.getTest(file)!);
            treeItem.addChildren(Array.from(fileTests.values()) ?? []);

            this._treeNodes.push(treeItem);
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    async runAllTests(): Promise<void> {
        applyIconToTreeItems(this._treeNodes, getIcon(TavernTestState.Running));
        this._onDidChangeTreeData.fire(undefined);

        const testFiles = await this.discoverTavernTestFiles();
        // this._testsManager.addTestFiles(Array.from(testFiles.values()).map(t => t.fsPath));
        this._testsManager.loadTestFiles(Array.from(testFiles.values()).map(t => t.fsPath));

        let tests = await this._testsManager.runTest();
        
        // Repopulate the tree
        this._treeNodes.length = 0;
        for (let [file, fileTests] of tests) {
            let treeItem = new TavernTestTreeItem(tests.getTest(file)!);
            treeItem.addChildren(Array.from(fileTests.values()) ?? []);

            this._treeNodes.push(treeItem);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    async runTest(item: TavernTestTreeItem): Promise<void> {
        // Set the tree item's icon and all the children items' icon to running.
        item.iconPath = getIcon(TavernTestState.Running);
        applyIconToTreeItems(item.children, getIcon(TavernTestState.Running));
        this._onDidChangeTreeData.fire(undefined);

        let tests = await this._testsManager.runTest(item.test);
        item.test.result = tests.getTest(item.test)!.result;

        // Set the tree item's icon with the test's current state, update the state of each of the
        // children items and, finally, set the item's parent icon.
        item.iconPath = getIcon(item.test.result.state);
        applyIconToTreeItems(item.children);

        if (item.parentTest !== undefined) {
            item.parentTest.iconPath = getIcon(item.parentTest.test.result.state);
        }
        this._onDidChangeTreeData.fire(undefined);

        // Update the decoration of the test in the file, if the file is open. If it isn't, then do 
        // nothing.
        const document = workspace.textDocuments.find(
            (d: TextDocument) => basename(d.fileName) === item.test.fileName);

        if (document !== undefined) {
            let editor = await window.showTextDocument(document);
            this.decorateFile(editor);
        }
    }
}


class TavernTestTreeItem extends TreeItem {
    children: TavernTestTreeItem[] = [];
    readonly contextValue: string;
    private _decorationOptions: DecorationOptions | undefined = undefined;

    constructor(
        public readonly test: TavernTest,
        public readonly parentTest: TavernTestTreeItem | undefined = undefined) {

        super(
            test.name,
            test.type === TavernTestType.File
                ? TreeItemCollapsibleState.Collapsed
                : TreeItemCollapsibleState.None);
        this.iconPath = getIcon(test.result.state);
        // When a test is a paremeterTest, set the context to something else than
        // tavernTestTreeItem, so that the actions icons are not displayed when hovering it.
        this.contextValue = test.type !== TavernTestType.ParameterTest
            ? 'tavernTestTreeItem'
            : 'tavernTestTreeItemNoIcons';

        this._decorationOptions = this.updateDecorationOptions();
    }

    addChildren(tests: TavernTest[]): void {
        this.collapsibleState = TreeItemCollapsibleState.Collapsed;

        this.children.push.apply(
            this.children,
            tests.map((t: TavernTest) => {
                let treeItemTest = new TavernTestTreeItem(t, this);

                if (t.childrenTests.length > 0) {
                    treeItemTest.addChildren(t.childrenTests);
                }

                return treeItemTest;
            }));
    }

    get decorationOptions(): DecorationOptions | undefined {
        return this._decorationOptions;
    }

    private updateDecorationOptions(): DecorationOptions {
        const hoverMessage =
            this.test.type === TavernTestType.File || this.test.result.state === TavernTestState.Pass
                ? undefined
                : new MarkdownString().appendCodeblock(this.test.result.failure ?? '');

        return {
            range: new Range(
                new Position(this.test.fileLine - 1, 0),
                new Position(this.test.fileLine - 1, 1024)),
            hoverMessage: hoverMessage
        };
    }
}
