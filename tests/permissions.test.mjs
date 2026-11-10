import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../electron/main.cjs', import.meta.url),'utf8');
function handlers() {
  let check, request;
  const session = { defaultSession: {
    setPermissionCheckHandler: fn => { check = fn; },
    setPermissionRequestHandler: fn => { request = fn; },
  } };
  const start = source.indexOf('  const isTrustedAppOrigin =');
  vm.runInNewContext(source.slice(start, source.indexOf("  if (process.platform === 'win32')",start)), { session });
  return { check, request: (permission,url,details={}) => {
    let allowed; request({ getURL: () => url },permission,result => { allowed = result; },{ requestingUrl:url,...details }); return allowed;
  } };
}
test('both Electron permission handlers allow user-triggered fullscreen in the packaged and local app', () => {
  const { check, request } = handlers();
  for (const url of ['file:///Applications/Stillnote/dist/index.html','http://127.0.0.1:5173','http://127.0.0.1:5173/']) {
    assert.equal(check({getURL:()=>url},'fullscreen',url),true);
    assert.equal(request('fullscreen',url),true);
  }
});
test('fullscreen stays denied for remote origins and lookalike development URLs', () => {
  const { check, request } = handlers();
  for (const url of ['https://example.com','http://127.0.0.1:51730/','http://127.0.0.1:5173.evil.test/']) {
    assert.equal(check(null,'fullscreen',url),false);
    assert.equal(request('fullscreen',url),false);
  }
});
test('microphone access is preserved and unrelated permissions remain denied', () => {
  const { request } = handlers(), url='file:///app/dist/index.html';
  assert.equal(request('media',url,{mediaTypes:['audio']}),true);
  assert.equal(request('media',url,{mediaTypes:['video']}),false);
  assert.equal(request('notifications',url),false);
  assert.equal(request('automatic-fullscreen',url),false);
});
