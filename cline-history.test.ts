import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { addClineHistoryToZip, assessClineHistory, collectClineHistory, readClineInfo, resolveClineRoots } from './cline-history';

function temporaryHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cline-history-'));
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function session(home: string, id: string, messages: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'Add a hello endpoint' }] }]): string {
  const dir = path.join(home, '.cline', 'data', 'sessions', id);
  writeJson(path.join(dir, `${id}.messages.json`), { sessionId: id, messages });
  writeJson(path.join(dir, `${id}.json`), { id });
  writeJson(path.join(dir, `${id}.compaction.json`), { compacted: true });
  return dir;
}

test('collects session-only history without compaction data', async () => {
  const home = temporaryHome();
  const id = '1700000001000_abcde';
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'Add a hello endpoint' }] },
    { role: 'user', content: [{ type: 'text', text: 'Return a greeting' }] },
    { role: 'tool', content: [{ type: 'tool_result', text: 'created' }] },
  ];
  session(home, id, messages);
  const roots = resolveClineRoots({ HOME: home }, 'linux', home);
  const collected = collectClineHistory(roots);
  assert.equal(collected.sessions.length, 1);
  assert.equal(assessClineHistory(collected).status, 'collected');
  const zip = new JSZip();
  await addClineHistoryToZip(zip, collected);
  const names = Object.keys(zip.files);
  assert.ok(names.includes(`cline_sessions/${id}/${id}.messages.json`));
  assert.ok(names.includes(`cline_sessions/${id}/${id}.json`));
  assert.ok(!names.some((name) => name.includes('compaction')));
});

test('resolves each configured session directory override', () => {
  const home = temporaryHome();
  assert.equal(resolveClineRoots({ HOME: home, CLINE_SESSION_DATA_DIR: ' /tmp/custom-sessions ' }, 'linux', home).sessionsDir, ' /tmp/custom-sessions ');
  assert.equal(resolveClineRoots({ HOME: home, CLINE_DATA_DIR: '/tmp/custom-cline' }, 'linux', home).sessionsDir, '/tmp/custom-cline/sessions');
  assert.equal(resolveClineRoots({ HOME: home, CLINE_DIR: '/tmp/cline' }, 'linux', home).sessionsDir, '/tmp/cline/data/sessions');
});

test('resolves Windows and macOS task roots', () => {
  const home = temporaryHome();
  const windows = resolveClineRoots({ USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming') }, 'win32', 'ignored');
  assert.ok(windows.taskRoots.includes(path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')));
  const mac = resolveClineRoots({ HOME: home }, 'darwin', home);
  assert.ok(mac.taskRoots.includes(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')));
});

test('collects mixed legacy tasks and session history', async () => {
  const home = temporaryHome();
  const roots = resolveClineRoots({ HOME: home }, 'linux', home);
  const id = '1700000000000';
  const taskDir = path.join(roots.taskRoots[0], id);
  writeJson(path.join(taskDir, 'api_conversation_history.json'), [{ role: 'user', content: 'Add a hello endpoint' }]);
  writeJson(path.join(taskDir, 'ui_messages.json'), [{ text: 'Add a hello endpoint' }]);
  const sessionId = '1700000001000_abcde';
  session(home, sessionId);
  const collected = collectClineHistory(roots);
  assert.equal(collected.tasks.length, 1);
  assert.equal(collected.sessions.length, 1);
  const zip = new JSZip();
  await addClineHistoryToZip(zip, collected);
  const names = Object.keys(zip.files);
  assert.ok(names.includes(`cline_history/${id}/ui_messages.json`));
  assert.ok(names.includes(`cline_sessions/${sessionId}/${sessionId}.messages.json`));
});

test('collects tasks from different roots', () => {
  const home = temporaryHome();
  const roots = resolveClineRoots({ HOME: home, APPDATA: path.join(home, 'Roaming') }, 'win32', home);
  const taskIds = ['1700000000000', '1700000000001'];
  for (const [index, root] of [roots.taskRoots[0], roots.taskRoots[1]].entries()) {
    writeJson(path.join(root, taskIds[index], 'api_conversation_history.json'), [{ role: 'user' }]);
  }
  assert.deepEqual(collectClineHistory(roots).tasks.map((task) => task.id).sort(), taskIds);
});

test('reports silent loss when v2 history is outside the expected session path', () => {
  const home = temporaryHome();
  const roots = resolveClineRoots({ HOME: home }, 'linux', home);
  const id = '1700000002000_fghij';
  const file = path.join(home, '.cline', 'data', 'sessions-v2', id, `${id}.messages.json`);
  writeJson(file, { sessionId: id, messages: [{ role: 'user', content: 'Add a hello endpoint' }] });
  const assessment = assessClineHistory(collectClineHistory(roots));
  assert.equal(assessment.status, 'silent-loss');
  assert.match(assessment.message, /contact support/);
  assert.match(assessment.message, new RegExp(id));
});

test('does not count empty histories or subagent message files as conversations', () => {
  const home = temporaryHome();
  const roots = resolveClineRoots({ HOME: home }, 'linux', home);
  writeJson(path.join(roots.taskRoots[0], '1700000000000', 'api_conversation_history.json'), []);
  const id = '1700000003000_klmno';
  writeJson(path.join(roots.sessionsDir, id, 'agent-7.messages.json'), { sessionId: id, messages: [{ role: 'user' }] });
  const collected = collectClineHistory(roots);
  assert.equal(collected.tasks.length, 0);
  assert.equal(collected.sessions.length, 0);
  assert.equal(assessClineHistory(collected).status, 'none');
});

test('reads unique extension versions in sorted order', () => {
  const home = temporaryHome();
  const roots = resolveClineRoots({ HOME: home }, 'linux', home);
  fs.mkdirSync(path.join(home, '.vscode-remote', 'extensions', 'saoudrizwan.claude-dev-4.1.26'), { recursive: true });
  fs.mkdirSync(path.join(home, '.vscode-server', 'extensions', 'saoudrizwan.claude-dev-4.0.1'), { recursive: true });
  fs.mkdirSync(path.join(home, '.vscode', 'extensions', 'saoudrizwan.claude-dev-4.1.26'), { recursive: true });
  assert.deepEqual(readClineInfo(roots).extensionVersions, ['4.0.1', '4.1.26']);
});
