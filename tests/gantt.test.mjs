import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { ganttTasks, ganttLayout, ganttCalendar, ganttScheduleStatus, ganttInstanceAt } from '../src/gantt.js';
import { applyGanttChanges } from '../electron/gantt-ai.mjs';
import { colors, ganttTaskColor, ganttInstances, lastGanttInstanceNumber, removeGanttInstance } from '../electron/gantt-model.mjs';

test('legacy tasks retain their inclusive all-day dates and timed durations', () => {
  const rows = [
    { title: 'All day', start: '2026-11-09', end: '2026-11-09' },
    { title: 'Timed', start: '2026-11-10T10:30', end: '2026-11-10T11:15' },
    { title: 'Missing date' },
  ];
  const original = JSON.stringify(rows);
  const { bars } = ganttLayout(rows);
  assert.deepEqual(bars.map(({ start, end }) => end - start), [24, 0.75]);
  assert.equal(JSON.stringify(rows), original);
});

test('nested tasks roll up duration-weighted progress and include milestones in their date range', () => {
  const rows = [
    { id: 'first', parentId: 'subgroup', start: '2026-11-09', end: '2026-11-11', progress: 50 },
    { id: 'group' },
    { id: 'subgroup', parentId: 'group' },
    { id: 'second', parentId: 'group', start: '2026-11-12', end: '2026-11-12', googleTask: { status: 'completed' } },
    { id: 'milestone', parentId: 'subgroup', start: '2026-11-28', milestone: true },
  ];
  const { ordered, byId } = ganttTasks(rows);
  assert.deepEqual(ordered.map(({ row, depth }) => [row.id, depth]), [
    ['group', 0], ['subgroup', 1], ['first', 2], ['milestone', 2], ['second', 1],
  ]);
  const group = byId.get('group');
  assert.equal(group.start, byId.get('first').start);
  assert.equal(group.end, byId.get('milestone').start);
  assert.equal(group.progress, 62.5);
  assert.equal(byId.get('milestone').weight, 0);
  assert.equal(ganttLayout(rows).bars.length, 5);
});

test('broken and cyclic parent links leave all rows reachable', () => {
  const rows = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'missing' }];
  const { ordered } = ganttTasks(rows);
  assert.equal(ordered.length, rows.length);
  assert.equal(ordered.filter(task => !task.parent).length, 2);
});

test('numbered task links survive reorder and deletion without reusing IDs', () => {
  const group = { id: 'group' };
  const first = { parentId: 'group' };
  const second = { parentId: 'group' };
  const initial = ganttTasks([group, first, second]);
  for (const { row, number } of initial.ordered) row.taskNumber = number;
  const added = { parentId: 'group' };
  const reordered = ganttTasks([added, second, group], initial.lastTaskNumber);
  assert.equal(reordered.numbered.get(3).row, second);
  assert.equal(reordered.numbered.has(2), false);
  assert.equal(reordered.numbered.get(4).row, added);
});

test('calendar switches between numeric months and days and numeric days and 24-hour hours', () => {
  const hours = value => Date.parse(value) / 3_600_000;
  const daily = ganttCalendar({ first: hours('2026-11-30'), last: hours('2026-12-03'), step: 24 });
  assert.deepEqual(daily.groups.map(tick => tick.label), ['11', '12']);
  assert.deepEqual(daily.ticks.map(tick => tick.label), ['30', '1', '2']);
  const hourly = ganttCalendar({ first: hours('2026-11-30T22:00Z'), last: hours('2026-12-01T02:00Z'), step: 1 });
  assert.deepEqual(hourly.groups.map(tick => tick.label), ['30', '01']);
  assert.deepEqual(hourly.ticks.map(tick => tick.label), ['22', '23', '00', '01']);
});

test('widest zoom groups actual calendar months by year', () => {
  const hours = value => Date.parse(value) / 3_600_000;
  const first = hours('2027-12-15');
  const last = hours('2028-03-02');
  const layout = ganttLayout([], { first, pixelsPerHour: 0.125, width: (last - first) * 0.125 });
  const { ticks, groups } = ganttCalendar(layout);
  assert.deepEqual(groups.map(group => group.label), ['2027', '2028']);
  assert.equal(groups[0].end, hours('2028-01-01'));
  assert.deepEqual(ticks.map(tick => [tick.label, (tick.end - tick.start) / 24]), [
    ['12', 31], ['01', 31], ['02', 29], ['03', 31],
  ]);
});

test('Gantt status picks the first active row and falls back to the earliest future start', () => {
  const now = time => Date.parse(`2026-11-14T${time}:00Z`) / 3_600_000;
  const task = (title, start, end, extra = {}) => ({
    title, start: `2026-11-14T${start}`, end: `2026-11-14T${end}`, ...extra,
  });
  const { ordered } = ganttTasks([
    { id: 'group', title: 'Summary' },
    task('Completed', '08:00', '13:00', { progress: 100 }),
    task('First active', '10:00', '12:00', { parentId: 'group' }),
    task('Second active', '09:00', '12:00'),
    task('Later', '17:00', '18:00'),
    task('First upcoming', '14:00', '16:00'),
    task('Same start', '14:00', '15:00'),
  ]);
  const selection = time => {
    const status = ganttScheduleStatus(ordered, now(time));
    return status && [status.label, status.task.row.title];
  };
  assert.deepEqual(selection('10:00'), ['Happening now', 'First active']);
  assert.deepEqual(selection('12:00'), ['Upcoming', 'First upcoming']);
  assert.deepEqual(selection('14:00'), ['Happening now', 'First upcoming']);
  assert.equal(selection('18:00'), null);
});

test('Gantt edit batches reject invalid dates, hierarchy cycles and direct edits of summary progress', () => {
  const data = { rows: [
    { taskNumber: 1, id: 'group', title: 'Group' },
    { taskNumber: 2, parentId: 'group', title: 'Task', start: '2026-11-16T10:00', end: '2026-11-16T12:00' },
  ] };
  const before = JSON.stringify(data);
  for (const [change, error] of [
    [{ taskNumber: 2, end: '2026-11-16T09:00' }, /after the start/],
    [{ taskNumber: 2, start: '2026-11-31' }, /valid start/],
    [{ taskNumber: 1, parentNumber: 2 }, /hierarchy cycle/],
    [{ taskNumber: 1, progress: 50 }, /progress of a summary task/],
  ]) {
    assert.throws(() => applyGanttChanges(data, [{ action: 'update', ...change }]), error);
    assert.equal(JSON.stringify(data), before);
  }
});

test('the chart assistant applies one undoable edit even when a prior edit is still grouped', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const section = (from, end) => source.slice(source.indexOf(from), source.indexOf(end));
  const state = { active: 'Plan.md' };
  const renderStructured = (type, data, file, title) => {
    state.structured = { type, data, file, title, undoStack: [], redoStack: [], historySnapshot: JSON.stringify({title, data}), historyPending: false };
  };
  const createElement = () => ({
    children: [],
    append(child) { this.children.push(child); },
    addEventListener(_type, listener) { this.click = listener; },
  });
  const messages = [];
  const editor = runInNewContext([
    section('function encodeStructured', 'function decodeStructured'),
    section('function isValidStructuredPayload', 'let desmosApiLoad'),
    section('function setStructuredDirty', 'function renderStructured'),
    section('function activeDocumentText', 'function updateAssistantModeCopy'),
    section('function appendAppliedEdit', 'async function readLinkedPdfContext'),
    '({ appendAppliedEdit, activeDocumentText })',
  ].join('\n'), {
    state, renderStructured, applyGanttChanges, lastGanttInstanceNumber, prettyName: () => 'Plan',
    document: { createElement, querySelectorAll: () => [] },
    $: () => ({}), appendChatBubble: (_role, text) => messages.push(text),
    renderSidebarLinks() {}, saveActive() {}, showToast: text => messages.push(text),
    setTimeout() {}, clearTimeout() {},
  });
  renderStructured('gantt', { version: 1, lastTaskNumber: 1, rows: [{ taskNumber: 1, title: 'Draft' }] }, state.active, 'Plan');
  state.structured.historyPending = true;
  const before = editor.activeDocumentText();
  const bubble = createElement();
  assert.equal(editor.appendAppliedEdit(bubble, JSON.stringify([{ action: 'add', title: 'Review' }]), state.active, before), true);
  const undoButton = bubble.children[1];
  assert.equal(state.structured.data.lastTaskNumber, 2);
  await undoButton.click();
  assert.equal(state.structured.data.rows.length, 1);
  assert.equal(state.structured.data.lastTaskNumber, 2);
  await undoButton.click();
  assert.equal(state.structured.data.rows[1].title, 'Review');
  assert.deepEqual(messages, []);
});

test('the 18 pastel colors use six hues and three saturations with lighter descendants', () => {
  const parts = value => value.match(/[\d.]+/g).map(Number);
  const palette = Object.values(colors).map(parts);
  assert.equal(palette.length, 18);
  assert.equal(new Set(palette.map(([hue]) => hue)).size, 6);
  assert.equal(new Set(palette.map(([, saturation]) => saturation)).size, 3);
  const { ordered } = ganttTasks([
    { id: 'root', color: 'Sky Rich' },
    { id: 'child', parentId: 'root', color: 'Rose' },
    { parentId: 'child' },
  ]);
  const [root, child, grandchild] = ordered.map(task => parts(ganttTaskColor(task)));
  assert.deepEqual(root.slice(0, 2), child.slice(0, 2));
  assert.deepEqual(child.slice(0, 2), grandchild.slice(0, 2));
  assert.ok(root[2] < child[2] && child[2] < grandchild[2]);
});

test('repeated tasks have separate times and keep their identities when the primary instance is removed', () => {
  const row = {
    taskNumber: 3, title: 'Review', progress: 25, start: '2026-11-16', end: '2026-11-16',
    instances: [
      { number: 2, start: '2026-11-18T10:00', end: '2026-11-18T11:00' },
      { number: 4, start: '2026-11-20', end: '2026-11-20' },
    ],
  };
  const [task] = ganttTasks([row]).ordered;
  assert.equal(task.number, 3);
  assert.deepEqual(task.ranges.map(range => range.number), [1, 2, 4]);
  assert.equal(task.weight, 49);
  const gap = Date.parse('2026-11-17T10:00Z') / 3_600_000;
  assert.equal(ganttScheduleStatus([task], gap).label, 'Upcoming');
  assert.equal(ganttScheduleStatus([task], gap).range.number, 2);
  assert.ok(removeGanttInstance(row, 1));
  assert.deepEqual(ganttInstances(row).map(entry => entry.number), [2, 4]);
  assert.ok(removeGanttInstance(row, 4));
  assert.equal(lastGanttInstanceNumber(row), 4);
  assert.equal(row.start, '2026-11-18T10:00');
  assert.equal(row.taskNumber, 3);
  assert.equal(row.progress, 25);
});

test('inserting an instance uses the clicked time and preserves the source duration', () => {
  const cursor = Date.parse('2026-11-20T12:07Z') / 3_600_000;
  const row = { start: '2026-11-16', end: '2026-11-17', lastInstanceNumber: 4 };
  assert.deepEqual(ganttInstanceAt(row, row, cursor), { number: 5, start: '2026-11-20', end: '2026-11-21' });
  const timed = { start: '2026-11-16T09:00', end: '2026-11-16T10:30' };
  assert.deepEqual(ganttInstanceAt(row, timed, cursor), { number: 5, start: '2026-11-20T12:00', end: '2026-11-20T13:30' });
  assert.deepEqual(ganttInstanceAt({ ...row, milestone: true }, timed, cursor), { number: 5, start: '2026-11-20T12:00', end: '2026-11-20T12:00' });
});

test('visible Gantt numbers follow sibling order while links retain their stable numbers', () => {
  const first = { id: 'first', taskNumber: 8 };
  const second = { id: 'second', taskNumber: 3 };
  const children = Array.from({ length: 4 }, (_, index) => ({
    id: 'child-' + index, parentId: 'second', taskNumber: 11 + index,
  }));
  const nested = { parentId: 'child-3', taskNumber: 20 };
  const model = ganttTasks([first, second, ...children, nested]);
  assert.deepEqual(model.ordered.map(task => task.displayNumber), ['1', '2', '2.1', '2.2', '2.3', '2.4', '2.4.1']);
  const reordered = ganttTasks([second, first, ...children.toReversed(), nested]);
  assert.equal(reordered.numbered.get(14).displayNumber, '1.1');
  assert.equal(reordered.numbered.get(20).displayNumber, '1.1.1');
  assert.equal(reordered.numbered.get(14).row, children[3]);
});
