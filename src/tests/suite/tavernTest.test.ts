import * as assert from 'assert';
// import { after } from 'mocha';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
import { TavernTest, TavernTestState, TavernTestType } from '../../tavernTest';
// import * as myExtension from '../extension';

suite('TavernTest suite', () => {
  // after(() => {
  //   vscode.window.showInformationMessage('All tests done!');
  // });

  test('Intantiate TavernTest', () => {
    let test = new TavernTest("test00", TavernTestType.File, "test00.file");
    test.result = {
      name: '',
      failure: '',
      state: TavernTestState.Pass
    };

    assert.strictEqual(test.result.state, TavernTestState.Pass);
  });
});