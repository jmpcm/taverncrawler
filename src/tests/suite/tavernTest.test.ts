import * as assert from 'assert';
// import { after } from 'mocha';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
import { TavernCrawlerTest, TavernTestState, TavernTestType } from '../../tavernCrawlerTest';
// import * as myExtension from '../extension';

suite('TavernTest suite', () => {
  // after(() => {
  //   vscode.window.showInformationMessage('All tests done!');
  // });

  test('Intantiate TavernTest', () => {
    let tavernTest = new TavernCrawlerTest("test00", TavernTestType.File, "test00.file");
    tavernTest.result = {
      name: '',
      lastRun: undefined,
      failure: '',
      state: TavernTestState.Pass
    };

    assert.strictEqual(tavernTest.result.state, TavernTestState.Pass);
  });
});