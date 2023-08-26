import { basename, join } from 'path';
import {
    DecorationOptions,
    DecorationRangeBehavior,
    Event,
    EventEmitter,
    ExtensionContext,
    FileRenameEvent,
    MarkdownString,
    Position,
    ProviderResult,
    Range,
    Selection,
    TextDocument,
    TextEditor,
    TextEditorDecorationType,
    TextEditorRevealType,
    ThemeColor,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    Uri,
    window,
    workspace
} from 'vscode';
import { TAVERN_FILE_EXTENSION } from './tavernCrawlerCommon';
import { TavernTestManager } from './tavernTestManager';
import { TavernTest, TavernTestState, TavernTestType } from './tavernTest';
import { TavernTestIndex } from './tavernTestIndex';


const testStatIcons: Record<TavernTestState, ThemeIcon> = {
    [TavernTestState.Fail]: new ThemeIcon('error',
        new ThemeColor('testing.iconFailed')),
    [TavernTestState.Pass]: new ThemeIcon('pass',
        new ThemeColor('testing.iconPassed')),
    [TavernTestState.Running]: new ThemeIcon('loading~spin'),
    [TavernTestState.Skipped]: new ThemeIcon('remote-explorer-review-issues',
        new ThemeColor('tavernCrawler.test.skipped.icon')),
    [TavernTestState.Unset]: new ThemeIcon('circle-large-outline',
        new ThemeColor('testing.iconUnset')),
    [TavernTestState.FailCached]: new ThemeIcon('error',
        new ThemeColor('testing.iconUnset')),
    [TavernTestState.SkippedCached]: new ThemeIcon('remote-explorer-review-issues',
        new ThemeColor('testing.iconUnset')),
    [TavernTestState.PassCached]: new ThemeIcon('pass', new ThemeColor('testing.iconUnset'))
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
                        gutterIconSize: '90%',
                        isWholeLine: true,
                        overviewRulerColor: new ThemeColor('testing.message.error.lineBackground'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
            case TavernTestState.FailCached:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: undefined,
                        border: undefined,
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "fail-cached.svg"),
                        gutterIconSize: '90%',
                        isWholeLine: true,
                        overviewRulerColor: new ThemeColor('testing.message.error.lineBackground'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
            case TavernTestState.Skipped:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: new ThemeColor('tavernCrawler.test.skipped.backgroundColor'),
                        border: 'solid',
                        borderWidth: '1px',
                        borderColor: new ThemeColor('tavernCrawler.test.skipped.border'),
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "skipped.svg"),
                        gutterIconSize: '90%',
                        isWholeLine: true,
                        overviewRulerColor: "#fbc02d80",
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
                    });
            case TavernTestState.SkippedCached:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: undefined,
                        border: undefined,
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "skipped-cached.svg"),
                        gutterIconSize: '90%',
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
                        gutterIconSize: '90%',
                        overviewRulerColor: new ThemeColor('testing.iconPassed'),
                        rangeBehavior: DecorationRangeBehavior.ClosedOpen
                    });
            case TavernTestState.PassCached:
                return window.createTextEditorDecorationType(
                    {
                        backgroundColor: undefined,
                        border: undefined,
                        gutterIconPath: join(__filename, "..", "..", "resources", "dark", "pass-cached.svg"),
                        gutterIconSize: '90%',
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
                        gutterIconSize: '90%',
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

export class TavernCrawlerProvider implements TreeDataProvider<TavernTestTreeItem> {
    // This structure stores the file name (string) and a set with all the file lines (number) that 
    // have been decorated. This way, when its time to decide if the line must be decorated, this 
    // structure can be used to do this assertion.
    private decoratorsMap = new DecorationsMap();
    private _onDidChangeTreeData = new EventEmitter<TavernTestTreeItem | undefined>();
    private readonly _testsManager: TavernTestManager;
    private _treeNodes: TavernTestTreeItem[] = [];
    private _workspaceTavernFiles = new Map<string, Uri>();

    readonly onDidChangeTreeData?: Event<TavernTestTreeItem | undefined> =
        this._onDidChangeTreeData.event;

    constructor(private context: ExtensionContext, testsManager: TavernTestManager) {
        this._testsManager = testsManager;

        window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor !== undefined && editor.document.fileName.endsWith(TAVERN_FILE_EXTENSION)) {
                this._decorateFile(editor);
            }
        });

        workspace.onDidRenameFiles(async (event: FileRenameEvent) => {
            if (event.files.length === 0) {
                return;
            }

            const renamedFiles = event.files.filter(
                fileRename => basename(fileRename.newUri.fsPath).endsWith(TAVERN_FILE_EXTENSION));
            let tests: TavernTestIndex;

            for (const file of renamedFiles) {
                this._testsManager.deleteTestFiles([file.oldUri.fsPath]);
                tests = await this._testsManager.loadTestFiles([file.newUri.fsPath]);
            }

            // Repopulate the tree when the document is saved, so that if there changes in the
            // number of tests, these are reflected in the tree.
            this._treeNodes.length = 0;
            for (let test of tests!.filter(TavernTestType.File)) {
                let treeItem = new TavernTestTreeItem(test);
                treeItem.addChildren(test.childrenTests);

                this._treeNodes.push(treeItem);
            }
            this._onDidChangeTreeData.fire(undefined);
        });

        workspace.onDidSaveTextDocument(async (document: TextDocument) => {
            const filename = basename(document.fileName);

            if (!filename.endsWith(TAVERN_FILE_EXTENSION)) {
                return;
            }

            let tests: TavernTestIndex;

            try {
                tests = await this._testsManager.loadTestResults([document.uri.fsPath]);
            } catch (error) {
                console.error(`[Tavern Crawler] ${error}`);
                return;
            }

            // Repopulate the tree when the document is saved, so that if there changes in the
            // number of tests, thiese are reflected in the tree.
            this._treeNodes.length = 0;
            for (let test of tests.filter(TavernTestType.File)) {
                let treeItem = new TavernTestTreeItem(test);
                treeItem.addChildren(test.childrenTests);

                this._treeNodes.push(treeItem);
            }
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    private async _decorateFile(editor: TextEditor): Promise<void> {
        let document = editor.document;
        let node = this._treeNodes.find(n => n.test.fileLocation === document.fileName);

        for (const child of node?.children!) {
            this.decoratorsMap.setDecoration(editor, child);
        }
    }

    private async _discoverTavernTestFiles(testsFolder?: string): Promise<Map<string, Uri>> {
        const files = await workspace.findFiles(
            testsFolder !== undefined
                ? `**/${testsFolder}/*${TAVERN_FILE_EXTENSION}`
                : `**/*${TAVERN_FILE_EXTENSION}`);

        return this._workspaceTavernFiles = new Map<string, Uri>(
            files.map(f => [f.fsPath, f])
        );
    }

    getChildren(element?: TavernTestTreeItem): ProviderResult<TavernTestTreeItem[]> {
        if (element) {
            return Promise.resolve(element.children);
        }

        return Promise.resolve(this._treeNodes);
    }

    getTreeItem = (node: TavernTestTreeItem) => node;

    async goToTest(item: TavernTestTreeItem): Promise<void> {
        if (item.test.fileLocation === undefined) {
            return;
        }

        let tavernTestFile = this._workspaceTavernFiles.get(item.test.fileLocation);

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

            this._decorateFile(editor);
        } else {
            startPos = new Position(item.test.fileLine - 1, 0);
            endPos = new Position(item.test.fileLine - 1, 1024);

            this.decoratorsMap.setDecoration(editor, item);
        }

        editor.revealRange(
            new Range(startPos, endPos),
            TextEditorRevealType.InCenterIfOutsideViewport);

        // Move the cursor to the beginning of the test line.
        editor.selection = new Selection(startPos, startPos);
    }

    async refresh() {
        // If the tests were previsouly loaded, then clear the tree first, otherwise the tests will
        // appear duplicated.
        this._treeNodes.length = 0;
        this._testsManager.deleteTestFiles();

        const testFiles = await this._discoverTavernTestFiles(this._testsManager.testsFolder);
        await this._testsManager.loadTestFiles(Array.from(testFiles.values()).map(t => t.fsPath));
        const tests = await this._testsManager.loadTestResults();

        for (let test of tests.filter(TavernTestType.File)) {
            let treeItem = new TavernTestTreeItem(test);
            treeItem.addChildren(test.childrenTests);

            this._treeNodes.push(treeItem);
        }

        // If the focused document is a test file, then decorate it.
        const focusedDocument = window.activeTextEditor?.document;

        if (focusedDocument !== undefined
            && tests.getTest(basename(focusedDocument.fileName)) !== undefined) {
            let editor = await window.showTextDocument(focusedDocument);
            this._decorateFile(editor);
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    async runAllTests(): Promise<void> {
        applyIconToTreeItems(this._treeNodes, getIcon(TavernTestState.Running));
        this._onDidChangeTreeData.fire(undefined);

        const tests = await this._testsManager.runTest();

        if (tests === undefined) {
            // TODO write to console the error
            return;
        }

        // Repopulate the tree
        this._treeNodes.length = 0;
        for (let test of tests.filter(TavernTestType.File)) {
            let treeItem = new TavernTestTreeItem(test);
            treeItem.addChildren(test.childrenTests);

            this._treeNodes.push(treeItem);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    async runTest(item: TavernTestTreeItem): Promise<void> {
        // Set the tree item's icon and all the children items' icon to running.
        item.iconPath = getIcon(TavernTestState.Running);
        applyIconToTreeItems(item.children, getIcon(TavernTestState.Running));
        this._onDidChangeTreeData.fire(undefined);

        try {
            await this._testsManager.runTest(item.test);
        } catch (error: any) {
            window.showErrorMessage(error.message);
        }

        // Set the tree item's icon with the test's current state, update the state of each of the
        // children items and, finally, set the item's parent icon.
        item.iconPath = getIcon(item.test.result.state);
        item.updateLabel();
        applyIconToTreeItems(item.children);

        if (item.parentTest !== undefined) {
            item.parentTest.iconPath = getIcon(item.parentTest.test.result.state);
        }
        this._onDidChangeTreeData.fire(undefined);

        // Update the decoration of the test in the file, if the file is open. If it isn't, then do 
        // nothing.
        const entries = workspace.textDocuments.entries();
        const document = workspace.textDocuments.find(
            (d: TextDocument) => d.fileName === item.test.fileLocation);

        if (document !== undefined) {
            let editor = await window.showTextDocument(document);
            this._decorateFile(editor);
        }
    }
}


class TavernTestTreeItem extends TreeItem {
    children: TavernTestTreeItem[] = [];
    readonly contextValue: string;

    constructor(
        public readonly test: TavernTest,
        public readonly parentTest: TavernTestTreeItem | undefined = undefined) {

        super(
            TavernTestTreeItem.createLabel(test),
            test.type === TavernTestType.File
                ? TreeItemCollapsibleState.Collapsed
                : TreeItemCollapsibleState.None);
        this.iconPath = getIcon(test.result.state);
        // When a test is a paremeterTest, set the context to something else than
        // tavernTestTreeItem, so that the actions icons are not displayed when hovering it.
        this.contextValue = test.type !== TavernTestType.ParameterTest
            ? 'tavernTestTreeItem'
            : 'tavernTestTreeItemNoIcons';
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

    updateLabel(): void {
        this.label = TavernTestTreeItem.createLabel(this.test);
    }

    private static createLabel(test: TavernTest): string {
        return test.type === TavernTestType.File
            ? `${test.relativeFileLocation}    [${test.childrenTestsPassCount}/${test.childrenTests.length}]`
            : test.name;
    }
}
