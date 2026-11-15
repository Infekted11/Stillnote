import test from 'node:test';
import assert from 'node:assert/strict';
import { ganttTasks, ganttLayout, ganttCalendar, ganttScheduleStatus } from '../src/gantt.js';

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
