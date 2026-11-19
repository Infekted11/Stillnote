import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAgenda, agendaSnapshot, relevantAgenda } from '../src/agenda.js';
import agenda from '../electron/agenda.cjs';

const encode = (type, data) => [
  `<!-- stillnote:type=${type} -->`, '', '\x60\x60\x60stillnote-' + type, JSON.stringify(data), '\x60\x60\x60',
].join('\n');
const decode = contents => {
  const lines = contents.split('\n');
  return { type: lines[2].slice(13), data: JSON.parse(lines[3]) };
};

test('agenda matches legacy Gantt numbering, keeps local dates and finds task links', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'stillnote-agenda-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Plans'));
  const files = {
    'Plans/Launch.md': encode('gantt', { rows: [
      { title: 'Review', start: '2026-11-14T09:00', end: '2026-11-14T11:00', notes: 'Read the draft\nSecond line', googleTask: { listId: 'list', taskId: 'task' } },
      { title: 'Launch', start: '2026-11-15', end: '2026-11-16' },
      { title: 'Past task', start: '2026-11-13', end: '2026-11-13' },
    ] }),
    'Draft.md': 'Draft\n<[!!!plans/Launch#task-1|Review]>\n;;Team/Check%20draft;;',
    'Other.md': 'No task references.',
  };
  await Promise.all(Object.entries(files).map(([file, body]) => writeFile(join(root, file), body)));
  const records = await agenda.readAgendaFiles(root, Object.keys(files), () => {});
  const google = { status: 'synced', lists: [
    { id: 'list', title: 'Team', tasks: [
      { id: 'task', title: 'Check draft', due: '2026-11-14T00:00:00Z', notes: 'Check attachments\nStillnote note: stillnote://open?note=Draft.md&line=3' },
      { id: 'past', title: 'Follow up', due: '2026-11-13' },
      { id: 'future', title: 'Send update', due: '2026-11-17' },
      { id: 'done', title: 'Done', status: 'completed' },
      { id: 'undated', title: 'Backlog' },
    ] },
  ] };
  const snapshot = agendaSnapshot(collectAgenda({ files: records, google }, decode), new Date(2026, 10, 14, 10));
  assert.deepEqual(snapshot.now.map(task => task.title), ['Follow up', 'Check draft', 'Review', 'Backlog']);
  assert.deepEqual(snapshot.upcoming.map(task => task.title), ['Launch', 'Send update']);
  assert.equal(snapshot.now[0].overdue, true);
  assert.equal(snapshot.now[2].progress, 50);
  assert.equal(snapshot.now[2].details, 'Read the draft');
  assert.deepEqual(snapshot.now[2].links, [{ file: 'Draft.md', fragment: 'L2' }, { file: 'Draft.md', fragment: 'L3' }]);
  assert.deepEqual(snapshot.now[1].links, [{ file: 'Draft.md', fragment: 'L3' }, { file: 'Plans/Launch.md', fragment: 'task-1' }]);
  assert.equal(snapshot.upcoming[0].end, '2026-11-16T00:00');
  assert.equal(snapshot.upcoming[0].progress, 0);

  const sidebar = relevantAgenda(snapshot, { file: 'Draft.md', prompt: 'Summarize the current project', paths: ['Plans/Launch.md'] });
  assert.deepEqual(sidebar.now.map(task => task.title), ['Check draft', 'Review']);
  assert.deepEqual(sidebar.upcoming, []);
  const explicit = relevantAgenda(snapshot, { file: 'Other.md', prompt: 'When can I send update?' });
  assert.deepEqual(explicit.upcoming.map(task => task.title), ['Send update']);
});

test('agenda context can page across both sections without splitting task records', () => {
  const tasks = Array.from({ length: 30 }, (_, index) => ({ id: index, title: `Task ${index}`, details: 'Review notes' }));
  const snapshot = { now: tasks.slice(0, 15), upcoming: tasks.slice(15) };
  const received = [];
  for (let offset = 0; offset !== null;) {
    const message = agenda.agendaContextMessage(snapshot, 500, offset);
    assert(message.length <= 500);
    const page = JSON.parse(message.split('\n')[1]);
    received.push(...page.now, ...page.upcoming);
    offset = page.nextOffset;
  }
  assert.deepEqual(received.map(task => task.title), tasks.map(task => task.title));
});

test('Agenda links to the specific numbered instance of a repeated Gantt task', () => {
  const files = [{ file: 'Plan.md', wiki: [], google: [], contents: encode('gantt', { rows: [
    { title: 'Review', taskNumber: 3, start: '2026-11-16', end: '2026-11-16',
      instances: [{ number: 4, start: '2026-11-20', end: '2026-11-20' }] },
  ] }) }];
  const data = collectAgenda({ files, google: { lists: [], status: 'synced' } }, decode);
  const snapshot = agendaSnapshot(data, new Date(2026, 10, 18, 10));
  assert.equal(snapshot.now.length, 0);
  assert.deepEqual(snapshot.upcoming.map(entry => [entry.title, entry.instanceNumber, entry.origin.fragment]), [
    ['Review', 4, 'task-3-instance-4'],
  ]);
  assert.equal(relevantAgenda(snapshot, { file: 'Other.md', prompt: 'When is Review?' }).upcoming.length, 1);
});
