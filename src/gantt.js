import { addDatePickers, styleFormValidation } from './form-controls.js';

const dayMs = 86_400_000;

function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / dayMs : NaN;
}

const hourMs = dayMs / 24;
const colors = {
  Lavender: '#cdc1eb', Peach: '#f3c7b1', Mint: '#bde0cd',
  Sky: '#b9d9ee', Rose: '#edbfd2', Butter: '#f1e2a8',
  Lilac: '#e1c1e8', Coral: '#f4bdb7', Sage: '#d4dfb5',
  Aqua: '#b4e2de', Periwinkle: '#bcc9f4', Sand: '#e8d2bb',
  Green: '#28bf43', Blue: '#1989ef', Magenta: '#df42ce',
};
const colorNames = Object.keys(colors);
const defaultColors = colorNames.slice(0, 12);
const taskColor = (row, index) => Object.hasOwn(colors, row.color) ? row.color : defaultColors[index % defaultColors.length];

function hour(value, end = false) {
  if (Number.isFinite(day(value))) return day(value) * 24 + (end ? 24 : 0);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return NaN;
  const timestamp = Date.parse(`${value}Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp / hourMs : NaN;
}

export const hourValue = (value) => new Date(Math.round(value * hourMs)).toISOString().slice(0, 16);

const tickIntervals = [1, 2, 4, 6, 12, 24, 48, 72, 168, 336, 672];
export const nowHour = (now = new Date()) => (now.getTime() - now.getTimezoneOffset() * 60_000) / hourMs;

const dateValue = value => hourValue(value).slice(0, 10);
const progressValue = row => row.googleTask?.status === 'completed' ? 100 : Math.min(100, Math.max(0, Number(row.progress) || 0));

export function ganttTasks(rows, lastTaskNumber = 0) {
  if (!Number.isSafeInteger(lastTaskNumber) || lastTaskNumber < 0) lastTaskNumber = 0;
  const tasks = rows.map((row, index) => ({ row, index, children: [] }));
  const byId = new Map(tasks.filter(task => task.row.id).map(task => [task.row.id, task]));
  const roots = [];
  for (const task of tasks) {
    const parent = byId.get(task.row.parentId);
    let ancestor = parent;
    while (ancestor && ancestor !== task) ancestor = ancestor.parent;
    if (parent && !ancestor && !parent.row.milestone) {
      task.parent = parent;
      parent.children.push(task);
    } else roots.push(task);
  }
  const ordered = [];
  function visit(task, depth) {
    task.depth = depth;
    ordered.push(task);
    for (const child of task.children) visit(child, depth + 1);
    const scheduled = task.children.filter(child => Number.isFinite(child.start));
    if (scheduled.length) {
      task.start = Math.min(...scheduled.map(child => child.start));
      task.end = Math.max(...scheduled.map(child => child.end));
      const total = scheduled.reduce((sum, child) => sum + child.weight, 0);
      task.progress = total ? scheduled.reduce((sum, child) => sum + child.weight * child.progress, 0) / total : 0;
      task.weight = total;
    } else {
      const start = hour(task.row.start);
      const end = task.row.milestone ? start : hour(task.row.end, true);
      task.start = end > start || (task.row.milestone && Number.isFinite(start)) ? start : NaN;
      task.end = end;
      task.progress = progressValue(task.row);
      task.weight = Number.isFinite(task.start) ? Math.max(0, end - start) : 0;
    }
  }
  for (const root of roots) visit(root, 0);
  const numbered = new Map();
  for (const task of ordered) {
    const number = task.row.taskNumber;
    if (!Number.isSafeInteger(number) || number < 1 || numbered.has(number)) continue;
    task.number = number;
    numbered.set(number, task);
    lastTaskNumber = Math.max(lastTaskNumber, number);
  }
  for (const task of ordered) {
    if (task.number) continue;
    task.number = ++lastTaskNumber;
    numbered.set(task.number, task);
  }
  return { ordered, byId, numbered, lastTaskNumber };
}

export function ganttScheduleStatus(tasks, now) {
  let upcoming;
  for (const task of tasks) {
    const { start, end, children, progress } = task;
    if (children.length || progress === 100 || !Number.isFinite(start)) continue;
    if (start <= now && now < end) return { label: 'Happening now', task };
    if (start >= now && (!upcoming || start < upcoming.start)) upcoming = task;
  }
  return upcoming ? { label: 'Upcoming', task: upcoming } : null;
}

function visibleTasks(tasks, collapsed, query) {
  const matches = new Set();
  if (query) {
    for (const task of tasks) {
      if (!String(task.row.title ?? '').toLocaleLowerCase().includes(query) && String(task.number) !== query) continue;
      for (let match = task; match && !matches.has(match); match = match.parent) matches.add(match);
    }
    return tasks.filter(task => matches.has(task));
  }
  const hidden = new Set();
  return tasks.filter(task => {
    if (!task.parent || !collapsed.has(task.parent.row.id) && !hidden.has(task.parent)) return true;
    hidden.add(task);
    return false;
  });
}

function scheduleBounds(tasks) {
  let first = Infinity;
  let last = -Infinity;
  for (const task of tasks) {
    if (!Number.isFinite(task.start)) continue;
    first = Math.min(first, task.start);
    last = Math.max(last, task.end);
  }
  return { first, last };
}

const weekHours = 168;
const sunday = 72; // 1970-01-04, measured in hours since the epoch.
const aligned = (value, step, offset = 0) => Math.floor((value - offset) / step) * step + offset;

export function ganttLayout(rows, viewport, tasks = ganttTasks(rows).ordered) {
  const bars = tasks.filter(task => Number.isFinite(task.start));
  if (viewport) {
    const { first, pixelsPerHour, width } = viewport;
    const step = tickIntervals.find(interval => interval * pixelsPerHour >= (interval >= 24 ? 25 : 46))
      ?? Math.ceil(25 / (weekHours * pixelsPerHour)) * weekHours;
    return { first, last: first + width / pixelsPerHour, step, bars };
  }
  if (!bars.length) return null;
  const { first: min, last: max } = scheduleBounds(bars);
  const step = tickIntervals.find(interval => Math.max(1, max - min) / interval <= 10)
    ?? Math.ceil((max - min) / (10 * weekHours)) * weekHours;
  const monthly = step >= weekHours;
  const first = monthly ? monthStart(min) : aligned(min, step);
  const last = monthly ? monthStart(max, 1) : aligned(max, step) + step;
  return { first, last, step, bars };
}

function wireTaskDrag(handle, bar, track, edge, row, draw, editor) {
  const initial = () => ({ start: hour(row.start), end: hour(row.milestone ? row.start : row.end, !row.milestone) });
  const adjust = (range, delta) => {
    if (edge === 'move') return { start: range.start + delta, end: range.end + delta };
    const duration = Math.min(editor.snap(row), range.end - range.start);
    if (edge === 'start') return { ...range, start: Math.min(range.end - duration, range.start + delta) };
    return { ...range, end: Math.max(range.start + duration, range.end + delta) };
  };
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    editor.resizeTask(row, adjust(initial(), delta * (event.shiftKey ? 24 : editor.snap(row))), edge);
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (editor.dragging) return;
    const bounds = track.getBoundingClientRect();
    const origin = event.clientX - bounds.left;
    if (!bounds.width) return;
    const range = initial();
    handle.setPointerCapture(event.pointerId);
    editor.dragging = true;
    bar.classList.add('is-dragging');
    const rangeAt = (pointer) => {
      const distance = pointer.clientX - track.getBoundingClientRect().left - origin;
      const snap = editor.snap(row);
      const delta = Math.round(distance / editor.pixelsPerHour / snap) * snap;
      return delta ? adjust(range, delta) : range;
    };
    const move = (pointer) => {
      if (pointer.pointerId === event.pointerId) draw(rangeAt(pointer));
    };
    const finish = (endEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', finish);
      bar.classList.remove('is-dragging');
      editor.dragging = false;
      const next = endEvent.type === 'pointerup' ? rangeAt(endEvent) : range;
      if (next.start !== range.start || next.end !== range.end) editor.resizeTask(row, next, edge, false);
      else draw(range);
      editor.onDragEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
}

function element(tag, className, label) {
  const node = document.createElement(tag);
  node.className = className;
  if (label) node.textContent = label;
  return node;
}

function actionButton(className, label, icon) {
  const button = element('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

export function ganttCalendar({ first, last, step }) {
  const hourly = step < 24;
  const monthly = step >= weekHours;
  const ticks = [];
  const groups = [];
  for (let start = monthly ? monthStart(first) : aligned(first, step); start < last;) {
    const end = monthly ? monthStart(start, 1) : start + step;
    const date = new Date(start * hourMs);
    const stamp = hourValue(start);
    const label = monthly ? stamp.slice(5, 7) : hourly ? stamp.slice(11, 13) : String(date.getUTCDate());
    ticks.push({
      start, end, label,
      title: monthly ? stamp.slice(0, 7) : hourly ? stamp.replace('T', ' ') : stamp.slice(0, 10),
      weekend: step === 24 && (date.getUTCDay() === 0 || date.getUTCDay() === 6),
    });
    start = end;
  }
  for (let start = monthly ? yearStart(first) : hourly ? aligned(first, 24) : monthStart(first); start < last;) {
    const end = monthly ? monthStart(start, 12) : hourly ? start + 24 : monthStart(start, 1);
    const date = dateValue(start);
    const label = monthly ? date.slice(0, 4) : hourly ? date.slice(8) : date.slice(5, 7);
    const title = monthly ? label : hourly ? date : date.slice(0, 7);
    groups.push({ start, end, label, title });
    start = end;
  }
  return { ticks, groups };
}

function renderCalendar(layout) {
  const { first, last } = layout;
  const grid = element('div', 'gantt-grid');
  const header = element('div', 'gantt-calendar');
  const groups = element('div', 'gantt-calendar-tier');
  const ticks = element('div', 'gantt-calendar-tier');
  function place(cell, { start, end, weekend }) {
    cell.style.left = `${(Math.max(first, start) - first) / (last - first) * 100}%`;
    cell.style.width = `${(Math.min(last, end) - Math.max(first, start)) / (last - first) * 100}%`;
    cell.classList.toggle('is-weekend', Boolean(weekend));
  }
  function renderCell(tick) {
    const cell = element('div', 'gantt-calendar-cell');
    cell.title = tick.title;
    cell.append(element('span', '', tick.label));
    place(cell, tick);
    return cell;
  }
  const calendar = ganttCalendar(layout);
  for (const tick of calendar.ticks) {
    const column = element('div', 'gantt-column');
    place(column, tick);
    grid.append(column);
    ticks.append(renderCell(tick));
  }
  for (const group of calendar.groups) groups.append(renderCell(group));
  header.append(groups, ticks);
  return { grid, header };
}

function yearStart(value) {
  const monthIndex = new Date(Math.floor(value * hourMs)).getUTCMonth();
  return monthStart(value, -monthIndex);
}

function monthStart(value, offset = 0) {
  const date = new Date(Math.floor(value * hourMs));
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.getTime() / hourMs;
}

function dependencyLayer(tasks, positions, layout, width = 640) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('gantt-dependencies');
  svg.setAttribute('aria-hidden', 'true');
  const indexById = new Map(tasks.filter(task => task.row.id).map(task => [task.row.id, task]));
  const links = [];
  for (const [index, task] of tasks.entries()) {
    for (const id of predecessors(task.row)) {
      const source = indexById.get(id);
      if (!source || source === task || !positions.has(source) || !positions.has(task)) continue;
      const path = document.createElementNS(svg.namespaceURI, 'path');
      const arrow = document.createElementNS(svg.namespaceURI, 'path');
      arrow.classList.add('gantt-arrowhead');
      links.push({ source, task, index, path, arrow });
      svg.append(path, arrow);
    }
  }
  if (!links.length) return null;
  const laneIndex = new Map(tasks.map((task, index) => [task, index]));
  const laneHeight = 38;
  svg.setAttribute('viewBox', `0 0 ${width} ${tasks.length * laneHeight}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const update = () => {
    const x = value => (value - layout.first) / (layout.last - layout.first) * width;
    for (const { source, task, index, path, arrow } of links) {
      const from = x(positions.get(source).end) + (source.row.milestone ? 8 : 0);
      const to = x(positions.get(task).start) - (task.row.milestone ? 8 : 0);
      const y1 = (laneIndex.get(source) + 0.5) * laneHeight;
      const y2 = (index + 0.5) * laneHeight;
      const bend = from + Math.max(12, (to - from) / 2);
      const mid = y1 + (y2 - y1) / 2;
      path.setAttribute('d', to - from > 25
        ? `M${from},${y1} H${bend} V${y2} H${to}`
        : `M${from},${y1} H${bend} V${mid} H${to - 12} V${y2} H${to}`);
      arrow.setAttribute('d', `M${to},${y2} l-7,-4 v8 z`);
    }
  };
  update();
  return { svg, update };
}

function predecessors(row) {
  return Array.isArray(row.predecessors) ? row.predecessors : [];
}

export function renderGanttTimeline(rows, editor, tasks = ganttTasks(rows).ordered) {
  const layout = ganttLayout(rows, editor, tasks);
  const timeline = element('div', 'gantt-timeline');
  if (!layout) {
    timeline.textContent = 'Add a task with dates to start the timeline.';
    return timeline;
  }
  if (editor) {
    timeline.classList.add('is-scrollable');
    timeline.style.setProperty('--gantt-track-width', `${editor.width}px`);
  }

  const { first, last } = layout;
  const percent = value => (value - first) / (last - first) * 100;
  const header = element('div', 'gantt-header');
  const labels = element('div', 'gantt-task-label gantt-label-header');
  if (editor) {
    const status = element('div', 'gantt-schedule-status');
    status.setAttribute('role', 'status');
    status.append(element('span', 'gantt-schedule-label'), element('span', 'gantt-schedule-task'));
    labels.append(status);
    const divider = actionButton('gantt-divider', 'Resize task list', '');
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    editor.wireDivider(divider);
    labels.append(divider);
  }
  const { grid, header: calendar } = renderCalendar(layout);
  header.append(labels, calendar);
  timeline.append(header);
  const body = element('div', 'gantt-body');
  body.append(grid);
  const lanes = element('div', 'gantt-lanes');
  if (editor && first <= editor.now && editor.now <= last) {
    const marker = element('span', 'gantt-now-marker');
    marker.style.left = `${percent(editor.now)}%`;
    grid.append(marker);
  }

  const positions = new Map();
  let dependencies;
  for (const task of tasks) {
    const { row, index, number, depth, children, start, end, progress } = task;
    const lane = element('div', 'gantt-lane');
    const label = element('div', 'gantt-task-label');
    label.dataset.taskIndex = String(index);
    if (children.length) lane.classList.add('is-summary');
    lane.classList.toggle('is-linked-task', editor?.linkedTaskNumber === number);
    const taskName = () => row.title || 'Untitled task';
    if (editor) {
      const grip = actionButton('gantt-grip', `Reorder ${taskName()}`, '⠿');
      editor.wireReorder(grip, label, task);
      label.append(grip);
      lane.addEventListener('contextmenu', event => {
        event.preventDefault();
        editor.openMenu(task, event.clientX, event.clientY);
      });
    }
    label.append(element('span', 'gantt-row-id', String(number)));
    const nameCell = element('div', 'gantt-name-cell');
    nameCell.style.paddingInlineStart = `${Math.min(depth, 8) * 13 + 6}px`;
    if (editor && children.length) {
      const expanded = editor.searching || !editor.collapsed.has(row.id);
      const toggle = actionButton('gantt-expand', expanded ? 'Collapse group' : 'Expand group', expanded ? editor.icons.down : editor.icons.chevron);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.disabled = editor.searching;
      toggle.addEventListener('click', () => editor.toggleGroup(row.id));
      nameCell.append(toggle);
    } else if (editor) nameCell.append(element('span', 'gantt-expand-spacer'));
    const name = element(editor ? 'input' : 'span', 'gantt-lane-name');
    let taskBar;
    if (editor) {
      name.type = 'text';
      name.maxLength = 200;
      name.placeholder = 'Untitled task';
      name.value = row.title ?? '';
      name.setAttribute('aria-label', `Task ${number} name`);
      name.addEventListener('input', () => {
        row.title = name.value;
        editor.onChange();
        editor.updateScheduleStatus();
        if (taskBar) taskBar({ start, end });
      });
      name.addEventListener('keydown', event => { if (event.key === 'Enter') name.blur(); });
    } else name.textContent = taskName();
    nameCell.append(name);
    label.append(nameCell);
    if (editor) {
      const actions = actionButton('gantt-task-actions', `Actions for task ${number}`, '⋮');
      actions.addEventListener('click', () => {
        const bounds = actions.getBoundingClientRect();
        editor.openMenu(task, bounds.right, bounds.bottom);
      });
      label.append(actions);
    }
    lane.append(label);

    const track = element('div', 'gantt-track');
    if (Number.isFinite(start)) {
      const bar = element('div', 'gantt-bar');
      bar.dataset.barIndex = String(index);
      bar.classList.toggle('is-milestone', Boolean(row.milestone));
      bar.style.setProperty('--gantt-bar-color', colors[taskColor(row, index)]);
      const fill = element('span', 'gantt-bar-fill');
      bar.append(fill);
      const button = editor ? actionButton('gantt-bar-body', taskName(), '') : element('span', 'gantt-bar-body');
      if (!editor) button.setAttribute('role', 'img');
      bar.append(button);
      const draw = (range) => {
        positions.set(task, range);
        const left = Math.max(first, range.start);
        const right = Math.min(last, range.end);
        bar.hidden = row.milestone ? range.start < first || range.start >= last : right <= left;
        bar.style.left = `${percent(left)}%`;
        if (!row.milestone && right > left) {
          bar.style.width = `${percent(right) - percent(left)}%`;
          const completed = range.start + (range.end - range.start) * progress / 100;
          const visibleProgress = Math.min(100, Math.max(0, (completed - left) / (right - left) * 100));
          fill.style.width = `${visibleProgress}%`;
          fill.classList.toggle('is-full', visibleProgress === 100);
        }
        const startLabel = hourValue(range.start).replace('T', ' ');
        const endLabel = hourValue(range.end).replace('T', ' ');
        const dates = row.milestone ? startLabel : `${startLabel} – ${endLabel}`;
        bar.dataset.dragLabel = dates;
        bar.title = `${taskName()} · ${dates}${row.milestone ? '' : ` · ${Math.round(progress)}%`}`;
        button.title = bar.title;
        button.setAttribute('aria-label', bar.title);
        dependencies?.update();
      };
      taskBar = draw;
      draw({ start, end });
      if (editor) {
        button.addEventListener('dblclick', () => editor.editTask(row));
        button.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          editor.editTask(row);
        });
        if (!children.length) {
          button.classList.add('is-move');
          wireTaskDrag(button, bar, track, 'move', row, draw, editor);
          if (!row.milestone) {
            for (const edge of ['start', 'end']) {
              const handle = actionButton(`gantt-handle is-${edge}`, `Resize task ${edge}`, '');
              bar.append(handle);
              wireTaskDrag(handle, bar, track, edge, row, draw, editor);
            }
          }
        }
      }
      track.append(bar);
    }
    lane.append(track);
    lanes.append(lane);
  }
  if (tasks.length) {
    dependencies = dependencyLayer(tasks, positions, layout, editor?.width);
    if (dependencies) lanes.append(dependencies.svg);
    body.append(lanes);
  } else if (editor) {
    body.append(element('p', 'gantt-empty gantt-task-label', editor.searching ? 'No matching tasks' : 'No tasks yet'));
  }
  if (editor) body.append(element('div', 'gantt-task-label gantt-rail'));
  timeline.append(body);
  return timeline;
}

function wireChartScrollbars(area, chart, extendScroll) {
  let drag;
  const updates = [];
  for (const axis of ['horizontal', 'vertical']) {
    const horizontal = axis === 'horizontal';
    const track = area.querySelector(`[data-scrollbar="${axis}"]`);
    const thumb = track.firstElementChild;
    const position = horizontal ? 'scrollLeft' : 'scrollTop';
    const viewport = horizontal ? 'clientWidth' : 'clientHeight';
    const extent = horizontal ? 'scrollWidth' : 'scrollHeight';
    const coordinate = horizontal ? 'clientX' : 'clientY';
    const max = () => Math.max(0, chart[extent] - chart[viewport]);

    function geometry() {
      const size = track[viewport];
      const length = Math.min(size, Math.max(28, size * chart[viewport] / chart[extent]));
      return { length, travel: size - length };
    }

    function update() {
      const limit = max();
      track.hidden = limit === 0;
      if (!limit) return;
      const { length, travel } = geometry();
      const offset = travel * chart[position] / limit;
      thumb.style[horizontal ? 'width' : 'height'] = `${length}px`;
      thumb.style.transform = horizontal ? `translateX(${offset}px)` : `translateY(${offset}px)`;
      thumb.setAttribute('aria-valuemax', String(limit));
      thumb.setAttribute('aria-valuenow', String(Math.round(chart[position])));
    }

    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const { travel } = geometry();
      if (!travel) return;
      event.preventDefault();
      thumb.focus({ preventScroll: true });
      thumb.setPointerCapture(event.pointerId);
      const controller = new AbortController();
      drag = controller;
      const options = { signal: controller.signal };
      thumb.classList.add('is-dragging');
      const start = chart[position];
      const origin = event[coordinate];
      function move(pointer) {
        if (pointer.pointerId !== event.pointerId) return;
        chart[position] = start + (pointer[coordinate] - origin) * max() / travel;
      }
      function finish(pointer) {
        if (pointer.pointerId !== event.pointerId) return;
        controller.abort();
        thumb.classList.remove('is-dragging');
        drag = null;
        extendScroll();
      }
      window.addEventListener('pointermove', move, options);
      window.addEventListener('pointerup', finish, options);
      window.addEventListener('pointercancel', finish, options);
      thumb.addEventListener('lostpointercapture', finish, options);
    });

    thumb.addEventListener('keydown', event => {
      const previous = horizontal ? 'ArrowLeft' : 'ArrowUp';
      const next = horizontal ? 'ArrowRight' : 'ArrowDown';
      const target = {
        [previous]: chart[position] - 40,
        [next]: chart[position] + 40,
        PageUp: chart[position] - chart[viewport],
        PageDown: chart[position] + chart[viewport],
        Home: 0,
        End: max(),
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      chart[position] = target;
    });
    updates.push(update);
  }

  function update() {
    for (const sync of updates) sync();
  }
  function onScroll() {
    if (!drag) extendScroll();
    update();
  }
  chart.addEventListener('scroll', onScroll);
  const observer = new ResizeObserver(update);
  observer.observe(chart);
  return {
    update,
    cleanup() {
      drag?.abort();
      observer.disconnect();
      chart.removeEventListener('scroll', onScroll);
    },
  };
}

export function renderGanttEditor(root, data, { icons, tasksApi, onChange, onHistory, copyTaskLink }) {
  if (!Array.isArray(data.rows)) data.rows = [];
  const toolbar = root.querySelector('.structured-toolbar');
  const surface = root.querySelector('.structured-surface');
  toolbar.innerHTML = `
    <button type="button" data-add title="Add task" aria-label="Add task">${icons.add}</button>
    <button type="button" data-group="expand" title="Expand all" aria-label="Expand all">${icons.expandAll}</button>
    <button type="button" data-group="collapse" title="Collapse all" aria-label="Collapse all">${icons.collapseAll}</button>
    <button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${icons.zoomIn}</button>
    <button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${icons.zoomOut}</button>
    <button type="button" data-zoom="fit" title="Zoom to fit" aria-label="Zoom to fit">${icons.fit}</button>
    <button type="button" data-today title="Jump to today" aria-label="Jump to today">${icons.ganttToday}</button>
    <div class="gantt-utility">
      <button type="button" data-google title="Link Google Task" aria-label="Link Google Task">${icons.link}</button>
      <button type="button" data-history="undo" title="Undo" aria-label="Undo">${icons.undo}</button>
      <button type="button" data-history="redo" title="Redo" aria-label="Redo">${icons.redo}</button>
    </div>
    <label class="gantt-search">${icons.search}<input type="search" placeholder="Search" aria-label="Search tasks"></label>
    <span class="gantt-status" role="status"></span>`;
  surface.innerHTML = `
    <div class="gantt-scroll-area">
      <div id="gantt-chart" class="gantt-chart" tabindex="0" role="region" aria-label="Scrollable Gantt timeline"></div>
      <div class="gantt-scrollbar" data-scrollbar="horizontal" hidden>
        <div tabindex="0" role="scrollbar" aria-label="Scroll timeline horizontally" aria-controls="gantt-chart" aria-orientation="horizontal" aria-valuemin="0"></div>
      </div>
      <div class="gantt-scrollbar" data-scrollbar="vertical" hidden>
        <div tabindex="0" role="scrollbar" aria-label="Scroll task rows vertically" aria-controls="gantt-chart" aria-orientation="vertical" aria-valuemin="0"></div>
      </div>
    </div>
    <div class="canvas-color-palette gantt-color-menu" popover aria-label="Task actions"></div>
    <dialog class="gantt-details rename-dialog" aria-labelledby="gantt-details-heading">
      <form method="dialog">
        <h3 id="gantt-details-heading"></h3>
        <label>Task name<input class="settings-input" name="title" maxlength="200" required data-required-message="Enter a task name." autofocus></label>
        <label>Details<input class="settings-input" name="notes" maxlength="500" placeholder="Optional"></label>
        <div class="gantt-checks">
          <label><input class="stillnote-checkbox" type="checkbox" name="allDay"> All day</label>
          <label><input class="stillnote-checkbox" type="checkbox" name="milestone"> Milestone</label>
        </div>
        <div class="gantt-date-fields">
          <div class="gantt-date-field">
            <label for="gantt-start-date">Start</label>
            <input id="gantt-start-date" class="settings-input" type="date" name="start" required data-required-message="Choose a start date.">
            <input class="settings-input gantt-time" name="startTime" aria-label="Start time (24-hour)" title="Start time (HH:mm)" placeholder="HH:mm" maxlength="5" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" required data-required-message="Enter a start time." data-format-message="Use 24-hour time (HH:mm).">
          </div>
          <div class="gantt-date-field">
            <label for="gantt-end-date">End</label>
            <input id="gantt-end-date" class="settings-input" type="date" name="end" required data-required-message="Choose an end date.">
            <input class="settings-input gantt-time" name="endTime" aria-label="End time (24-hour)" title="End time (HH:mm)" placeholder="HH:mm" maxlength="5" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" required data-required-message="Enter an end time." data-format-message="Use 24-hour time (HH:mm).">
          </div>
        </div>
        <label>Progress (%)<input class="settings-input" name="progress" type="number" min="0" max="100"></label>
        <label>Parent task<select class="settings-input" name="parent"></select></label>
        <fieldset class="gantt-predecessors"><legend>Predecessors</legend><div></div></fieldset>
        <div class="rename-actions"><button class="secondary-button" type="button" data-cancel title="Cancel" aria-label="Cancel">${icons.close}</button><button class="primary-button" value="save" title="Save task" aria-label="Save task">${icons.statusCheck}</button></div>
      </form>
    </dialog>
    <dialog class="gantt-picker rename-dialog"><form method="dialog"><h3>Link Google Task</h3><label>Task list<select class="settings-input" data-list required></select></label><label>Task<select class="settings-input" data-task required></select></label><p role="status"></p><div class="rename-actions"><button class="secondary-button" type="button" data-picker-cancel title="Cancel" aria-label="Cancel">${icons.close}</button><button class="primary-button" value="link" title="Link task" aria-label="Link task" disabled>${icons.link}</button></div></form></dialog>`;
  surface.prepend(toolbar);
  const chart = surface.querySelector('.gantt-chart');
  const menu = surface.querySelector('.gantt-color-menu');
  const status = toolbar.querySelector('[role=status]');
  const search = toolbar.querySelector('[type=search]');
  const picker = surface.querySelector('.gantt-picker');
  const listSelect = picker.querySelector('[data-list]');
  const taskSelect = picker.querySelector('[data-task]');
  const pickerStatus = picker.querySelector('[role=status]');
  const linkButton = picker.querySelector('[value=link]');
  picker.querySelector('[data-picker-cancel]').addEventListener('click', () => picker.close());
  const zoomOut = toolbar.querySelector('[data-zoom=out]');
  const zoomIn = toolbar.querySelector('[data-zoom=in]');
  const details = surface.querySelector('.gantt-details');
  const form = details.querySelector('form');
  addDatePickers(form, icons.ganttToday);
  styleFormValidation(form);
  styleFormValidation(picker.querySelector('form'));
  const { title, notes, start, end, startTime, endTime, allDay, milestone, progress, parent } = form.elements;
  details.querySelector('[data-cancel]').addEventListener('click', () => details.close());
  const predecessorList = details.querySelector('.gantt-predecessors div');
  const buffer = 6000;
  const minScale = 0.125;
  const maxScale = 128;
  let model = ganttTasks(data.rows, data.lastTaskNumber);
  let repaintPending = false;
  let reorderSource;
  let editingTask;
  const editor = {
    first: nowHour(),
    pixelsPerHour: 1.5,
    width: buffer * 2,
    dragging: false,
    searching: '',
    collapsed: new Set(),
    icons,
    onChange,
    resizeTask,
    openMenu,
    editTask,
    wireDivider,
    wireReorder,
    updateScheduleStatus,
    snap(row) {
      if (editor.pixelsPerHour < 4 && Number.isFinite(day(row.start))) return 24;
      return editor.pixelsPerHour >= 24 ? 0.25 : 1;
    },
    toggleGroup(id) {
      if (!editor.collapsed.delete(id)) editor.collapsed.add(id);
      refreshChart();
      chart.querySelector(`[data-task-index="${model.byId.get(id).index}"] .gantt-expand`)?.focus({ preventScroll: true });
    },
    onDragEnd() {
      if (repaintPending) refreshChart();
      extendScroll();
    },
  };
  function refreshChart(scroll = chart.scrollLeft) {
    if (editor.dragging) { repaintPending = true; return; }
    repaintPending = false;
    editor.now = nowHour();
    const tasks = visibleTasks(model.ordered, editor.collapsed, editor.searching);
    chart.replaceChildren(renderGanttTimeline(data.rows, editor, tasks));
    updateScheduleStatus(editor.now);
    chart.scrollLeft = scroll;
    scrollbars.update();
    zoomOut.disabled = editor.pixelsPerHour <= minScale;
    zoomIn.disabled = editor.pixelsPerHour >= maxScale;
  }
  function updateScheduleStatus(now = nowHour()) {
    const status = chart.querySelector('.gantt-schedule-status');
    if (!status) return;
    const next = ganttScheduleStatus(model.ordered, now);
    const title = next?.task.row.title?.trim() || 'Untitled task';
    status.hidden = !next;
    if (!next) return;
    const [label, task] = status.children;
    if (label.textContent !== next.label) label.textContent = next.label;
    if (task.textContent !== title) {
      task.textContent = title;
      task.title = title;
    }
  }
  function extendScroll() {
    if (editor.dragging) return;
    const scroll = chart.scrollLeft;
    const max = chart.scrollWidth - chart.clientWidth;
    if (max <= 0 || (scroll >= 750 && max - scroll >= 750)) return;
    editor.first += (scroll - buffer) / editor.pixelsPerHour;
    refreshChart(buffer);
  }
  const scrollbars = wireChartScrollbars(chart.parentElement, chart, extendScroll);
  const labelWidth = () => chart.querySelector('.gantt-label-header')?.offsetWidth ?? Math.max(Math.min(146, chart.clientWidth * 0.5), chart.clientWidth * 0.32);
  const availableWidth = () => Math.max(100, chart.clientWidth - labelWidth());
  function zoom(factor) {
    if (editor.dragging) return;
    const center = availableWidth() / 2;
    const anchor = editor.first + (chart.scrollLeft + center) / editor.pixelsPerHour;
    editor.pixelsPerHour = Math.min(maxScale, Math.max(minScale, editor.pixelsPerHour * factor));
    editor.first = anchor - (buffer + center) / editor.pixelsPerHour;
    refreshChart(buffer);
  }
  function zoomToFit() {
    if (editor.dragging) return;
    const { first, last } = scheduleBounds(model.ordered);
    const width = availableWidth();
    const padding = Math.min(30, width * 0.08);
    if (Number.isFinite(first)) {
      const duration = Math.max(24, last - first);
      editor.pixelsPerHour = Math.min(2.5, (width - padding * 2) / duration);
      editor.first = Math.floor(first / 24) * 24 - (buffer + padding) / editor.pixelsPerHour;
      // Hour-based tasks can start well into the first day at this zoom.
      if ((last - editor.first) * editor.pixelsPerHour > buffer + width - padding / 2) {
        editor.first = first - (buffer + padding) / editor.pixelsPerHour;
      }
    } else {
      editor.pixelsPerHour = 1.5;
      editor.first = aligned(nowHour(), weekHours, sunday) - buffer / editor.pixelsPerHour;
    }
    refreshChart(buffer);
  }
  zoomIn.addEventListener('click', () => zoom(1.5));
  zoomOut.addEventListener('click', () => zoom(1 / 1.5));
  toolbar.querySelector('[data-zoom=fit]').addEventListener('click', zoomToFit);
  toolbar.querySelector('[data-today]').addEventListener('click', () => {
    if (editor.dragging) return;
    editor.first = nowHour() - (buffer + availableWidth() / 2) / editor.pixelsPerHour;
    refreshChart(buffer);
  });
  search.addEventListener('input', () => {
    editor.searching = search.value.trim().toLocaleLowerCase();
    refreshChart();
  });
  for (const button of toolbar.querySelectorAll('[data-group]')) {
    button.addEventListener('click', () => {
      search.value = editor.searching = '';
      editor.collapsed = new Set(button.dataset.group === 'collapse'
        ? model.ordered.filter(task => task.children.length).map(task => task.row.id) : []);
      refreshChart();
    });
  }

  function wireDivider(divider) {
    const resize = width => {
      chart.style.setProperty('--gantt-pane-width', `${width}px`);
      scrollbars.update();
    };
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || editor.dragging) return;
      const initial = labelWidth();
      divider.setPointerCapture(event.pointerId);
      const move = pointer => resize(initial + pointer.clientX - event.clientX);
      const finish = () => divider.removeEventListener('pointermove', move);
      divider.addEventListener('pointermove', move);
      divider.addEventListener('lostpointercapture', finish, { once: true });
    });
    divider.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      resize(labelWidth() + (event.key === 'ArrowRight' ? 16 : -16));
    });
  }
  function wireReorder(grip, label, task) {
    grip.draggable = true;
    grip.addEventListener('dragstart', event => {
      reorderSource = task;
      event.dataTransfer.setData('text/plain', task.row.title || 'Untitled task');
      event.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => { reorderSource = null; });
    const canDrop = () => reorderSource && reorderSource !== task && reorderSource.parent === task.parent;
    label.addEventListener('dragover', event => {
      if (!canDrop()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      label.classList.add('is-drop-target');
    });
    label.addEventListener('dragleave', () => label.classList.remove('is-drop-target'));
    label.addEventListener('drop', event => {
      if (!canDrop()) return;
      event.preventDefault();
      moveRow(reorderSource, task);
      reorderSource = null;
    });
    grip.addEventListener('keydown', event => {
      const direction = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!direction) return;
      const siblings = model.ordered.filter(item => item.parent === task.parent);
      const target = siblings[siblings.indexOf(task) + direction];
      if (!target) return;
      event.preventDefault();
      moveRow(task, target);
    });
  }
  function moveRow(source, target) {
    const from = source.index;
    const to = target.index;
    for (const task of model.ordered) {
      if (task.index >= Math.min(from, to) && task.index <= Math.max(from, to)) task.row.color ??= taskColor(task.row, task.index);
    }
    data.rows.splice(from, 1);
    data.rows.splice(to, 0, source.row);
    save();
    chart.querySelector(`[data-task-index="${to}"] .gantt-grip`)?.focus({ preventScroll: true });
  }

  function persistTaskNumbers() {
    for (const task of model.ordered) task.row.taskNumber = task.number;
    data.lastTaskNumber = model.lastTaskNumber;
  }
  function save() {
    model = ganttTasks(data.rows, data.lastTaskNumber);
    persistTaskNumbers();
    onChange();
    refreshChart();
  }
  function resizeTask(row, range, edge, focus = true) {
    const startDateOnly = Number.isFinite(day(row.start));
    const endDateOnly = Number.isFinite(day(row.end));
    row.start = startDateOnly && range.start % 24 === 0 ? dateValue(range.start) : hourValue(range.start);
    if (!row.milestone) row.end = endDateOnly && range.end % 24 === 0 ? dateValue(range.end - 24) : hourValue(range.end);
    save();
    if (focus) {
      const index = data.rows.indexOf(row);
      const handle = edge === 'move' ? '.gantt-bar-body' : `.gantt-handle.is-${edge}`;
      chart.querySelector(`[data-bar-index="${index}"] ${handle}`)?.focus({ preventScroll: true });
    }
  }
  function addRow(row) {
    row.color ??= taskColor(row, data.rows.length);
    data.rows.push(row);
    if (row.parentId) editor.collapsed.delete(row.parentId);
    search.value = editor.searching = '';
    save();
    const left = editor.first + chart.scrollLeft / editor.pixelsPerHour;
    const rowStart = hour(row.start);
    const rowEnd = row.milestone ? rowStart : hour(row.end, true);
    if (rowStart < left || rowEnd > left + availableWidth() / editor.pixelsPerHour) zoomToFit();
    chart.querySelector(`[data-task-index="${data.rows.length - 1}"] input`)?.focus();
  }
  const today = () => dateValue(nowHour());
  function ensureId(row) {
    row.id ||= crypto.randomUUID();
    return row.id;
  }
  function updateDateFields() {
    end.disabled = milestone.checked || start.disabled;
    end.closest('.gantt-date-field').hidden = milestone.checked;
    startTime.hidden = allDay.checked;
    endTime.hidden = allDay.checked;
    startTime.disabled = allDay.checked || start.disabled;
    endTime.disabled = allDay.checked || end.disabled;
    progress.disabled = milestone.checked || Boolean(model.ordered.find(task => task.row === editingTask)?.children.length);
  }
  allDay.addEventListener('change', () => {
    if (!allDay.checked && end.value && endTime.value === '00:00' && !milestone.checked) {
      end.value = dateValue(hour(end.value, true));
    } else if (allDay.checked && end.value && endTime.value === '00:00' && end.value > start.value) {
      end.value = dateValue(hour(end.value) - 24);
    }
    updateDateFields();
  });
  milestone.addEventListener('change', updateDateFields);
  function editTask(row, suggestedParent = null) {
    editingTask = row;
    details.querySelector('h3').textContent = row ? 'Edit task' : suggestedParent ? 'Add subtask' : 'Add task';
    const task = model.ordered.find(item => item.row === row);
    const summary = task?.children.some(child => Number.isFinite(child.start));
    title.value = row?.title ?? '';
    notes.value = row?.notes ?? row?.description ?? '';
    allDay.checked = !row || Number.isFinite(day(row.start)) && (row.milestone || Number.isFinite(day(row.end)));
    if (summary) allDay.checked = task.start % 24 === 0 && task.end % 24 === 0 && task.start !== task.end;
    milestone.checked = Boolean(row?.milestone);
    milestone.disabled = Boolean(task?.children.length);
    const defaultStart = allDay.checked ? hour(today()) : Math.floor(nowHour());
    const first = summary ? task.start : hour(row?.start);
    const last = summary ? task.end : hour(row?.end, true);
    const startValue = hourValue(Number.isFinite(first) ? first : defaultStart);
    const endValue = hourValue(Number.isFinite(last)
      ? last - (allDay.checked && !row?.milestone ? 24 : 0)
      : defaultStart + (allDay.checked ? 0 : 1));
    start.value = startValue.slice(0, 10);
    startTime.value = startValue.slice(11, 16);
    end.value = endValue.slice(0, 10);
    endTime.value = endValue.slice(11, 16);
    allDay.disabled = start.disabled = Boolean(summary);
    end.setCustomValidity('');
    endTime.setCustomValidity('');
    progress.value = Math.round(task?.progress ?? 0);
    parent.replaceChildren(new Option('None', ''));
    predecessorList.replaceChildren();
    const taskLabel = item => `${item.number}. ${item.row.title || 'Untitled task'}`;
    function dependsOnTask(item, visited = new Set()) {
      if (item === task) return true;
      if (!item || visited.has(item)) return false;
      visited.add(item);
      return predecessors(item.row).some(id => dependsOnTask(model.byId.get(id), visited));
    }
    for (const item of model.ordered) {
      let ancestor = item;
      while (ancestor && ancestor !== task) ancestor = ancestor.parent;
      if (!ancestor && !item.row.milestone) parent.add(new Option(taskLabel(item), item.index));
      if (dependsOnTask(item)) continue;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'stillnote-checkbox';
      checkbox.value = item.index;
      checkbox.checked = Boolean(row && predecessors(row).includes(item.row.id));
      const label = element('label', '');
      label.append(checkbox, document.createTextNode(taskLabel(item)));
      predecessorList.append(label);
    }
    if (!predecessorList.children.length) predecessorList.append(element('small', '', 'No available tasks'));
    parent.value = task?.parent ? String(task.parent.index) : suggestedParent ? String(data.rows.indexOf(suggestedParent)) : '';
    updateDateFields();
    details.showModal();
  }
  for (const input of [start, end, startTime, endTime, allDay, milestone]) {
    input.addEventListener('input', () => {
      end.setCustomValidity('');
      endTime.setCustomValidity('');
    });
  }
  form.addEventListener('submit', event => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const startValue = allDay.checked ? start.value : `${start.value}T${startTime.value}`;
    const endValue = allDay.checked ? end.value : `${end.value}T${endTime.value}`;
    if (!start.disabled && !milestone.checked && hour(endValue, true) <= hour(startValue)) {
      const field = allDay.checked ? end : endTime;
      field.setCustomValidity('End must be after the start time.');
      field.reportValidity();
      return;
    }
    const row = editingTask ?? {};
    row.title = title.value.trim() || 'Untitled task';
    if (notes.value.trim() || row.notes || row.description) row.notes = notes.value.trim();
    if (!start.disabled) {
      row.start = startValue;
      row.end = milestone.checked ? startValue : endValue;
      row.milestone = milestone.checked;
    }
    if (!progress.disabled) row.progress = Number(progress.value);
    const group = parent.value === '' ? null : data.rows[Number(parent.value)];
    if (group) {
      row.parentId = ensureId(group);
      editor.collapsed.delete(row.parentId);
    } else delete row.parentId;
    row.predecessors = Array.from(predecessorList.querySelectorAll('input:checked'), checkbox => ensureId(data.rows[Number(checkbox.value)]));
    details.close('save');
    if (editingTask) save();
    else addRow(row);
  });

  function openMenu(task, x, y) {
    const { row } = task;
    if (menu.matches(':popover-open')) menu.hidePopover();
    menu.replaceChildren();
    const palette = document.createElement('div');
    palette.className = 'gantt-swatch-grid';
    for (const [name, value] of Object.entries(colors)) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'canvas-color-swatch';
      swatch.style.setProperty('--swatch', value);
      swatch.title = name;
      swatch.setAttribute('aria-label', `${name} color`);
      const active = taskColor(row, task.index) === name;
      swatch.setAttribute('aria-pressed', String(active));
      swatch.classList.toggle('active', active);
      swatch.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.8"/></svg>';
      swatch.addEventListener('click', () => {
        row.color = name;
        menu.hidePopover();
        save();
      });
      palette.append(swatch);
    }
    menu.append(palette);
    const actions = element('div', 'gantt-menu-actions');
    menu.append(actions);
    const action = (label, icon, run) => {
      const button = actionButton('secondary-button gantt-icon-button', label, icon);
      button.addEventListener('click', () => { menu.hidePopover(); run(); });
      actions.append(button);
    };
    action('Edit task', icons.ganttEdit, () => editTask(row));
    if (!row.milestone) action('Add subtask', icons.folderPlus, () => editTask(null, row));
    action('Copy task link', icons.duplicate, async () => {
      try {
        await copyTaskLink(task.number);
        if (root.isConnected) status.textContent = 'Task link copied.';
      } catch (error) { if (root.isConnected) status.textContent = error.message || 'Could not copy task link.'; }
    });
    if (row.googleTask) {
      const link = row.googleTask;
      const label = document.createElement('small');
      label.textContent = `${link.listTitle} / ${link.title}`;
      menu.append(label);
      action('Refresh Google Task', icons.refresh, async () => {
        status.textContent = 'Refreshing task…';
        try {
          const tasks = await tasksApi.listGoogleTasks(link.listId);
          if (!root.isConnected || row.googleTask !== link || !data.rows.includes(row)) return;
          const task = tasks.find(item => item.id === link.taskId);
          if (!task) throw new Error('The linked Google Task was not found.');
          link.status = task.status;
          link.title = task.title;
          status.textContent = 'Linked task refreshed.';
          save();
        } catch (error) { if (root.isConnected) status.textContent = error.message; }
      });
      action('Unlink Google Task', icons.ganttUnlink, () => { delete row.googleTask; save(); });
    } else action('Link Google Task', icons.link, () => void openTaskPicker(row));
    action('Remove task', icons.trash, () => {
      for (const child of task.children) {
        if (task.parent) child.row.parentId = task.parent.row.id;
        else delete child.row.parentId;
      }
      if (row.id) {
        for (const item of data.rows) {
          if (predecessors(item).includes(row.id)) item.predecessors = item.predecessors.filter(id => id !== row.id);
        }
      }
      data.rows.splice(data.rows.indexOf(row), 1);
      editor.collapsed.delete(row.id);
      save();
    });
    menu.showPopover();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    palette.querySelector('.active')?.focus();
  }
  for (const button of toolbar.querySelectorAll('[data-history]')) {
    button.addEventListener('click', () => onHistory(button.dataset.history));
  }
  toolbar.querySelector('[data-add]').addEventListener('click', () => editTask(null));
  let listRequest = 0;
  let tasks = [];
  let targetRow = null;
  async function loadTasks() {
    const request = ++listRequest;
    taskSelect.replaceChildren();
    linkButton.disabled = true;
    tasks = [];
    if (!listSelect.value) return;
    pickerStatus.textContent = 'Loading tasks…';
    try {
      const loaded = await tasksApi.listGoogleTasks(listSelect.value);
      if (request !== listRequest || !picker.open) return;
      tasks = loaded;
      taskSelect.replaceChildren(...tasks.map(task => new Option(task.title || 'Untitled task', task.id)));
      linkButton.disabled = !tasks.length;
      pickerStatus.textContent = tasks.length ? '' : 'This list has no tasks.';
    } catch (error) {
      if (request === listRequest && picker.open) pickerStatus.textContent = error.message;
    }
  }
  async function openTaskPicker(row = null) {
    targetRow = row;
    const request = ++listRequest;
    listSelect.replaceChildren();
    taskSelect.replaceChildren();
    linkButton.disabled = true;
    picker.returnValue = '';
    pickerStatus.textContent = 'Loading task lists…';
    picker.showModal();
    try {
      const lists = await tasksApi.listGoogleTaskLists();
      if (request !== listRequest || !picker.open) return;
      listSelect.replaceChildren(...lists.map(list => new Option(list.title, list.id)));
      if (lists.length) await loadTasks();
      else pickerStatus.textContent = 'No Google Tasks lists found.';
    } catch (error) {
      if (request === listRequest && picker.open) pickerStatus.textContent = error.message;
    }
  }
  toolbar.querySelector('[data-google]').addEventListener('click', () => void openTaskPicker());
  listSelect.addEventListener('change', loadTasks);
  picker.addEventListener('close', () => {
    ++listRequest;
    if (picker.returnValue !== 'link' || !root.isConnected) return;
    const task = tasks.find(item => item.id === taskSelect.value);
    if (!task) return;
    const due = task.due?.slice(0, 10);
    const date = Number.isFinite(day(due)) ? due : today();
    const title = task.title || 'Untitled task';
    const googleTask = {
      listId: listSelect.value, listTitle: listSelect.selectedOptions[0].text,
      taskId: task.id, title, status: task.status,
    };
    if (targetRow && data.rows.includes(targetRow)) {
      targetRow.googleTask = googleTask;
      save();
    } else if (!targetRow) addRow({ title, start: date, end: date, googleTask });
  });
  persistTaskNumbers();
  zoomToFit();
  function focusTask(number) {
    const task = model.numbered.get(number);
    if (!task || editor.dragging) return false;
    editor.linkedTaskNumber = number;
    search.value = editor.searching = '';
    for (let group = task.parent; group; group = group.parent) editor.collapsed.delete(group.row.id);
    if (Number.isFinite(task.start)) {
      const width = availableWidth();
      const taskDuration = task.end - task.start;
      if (taskDuration < 24 && !Number.isFinite(day(task.row.start))) {
        editor.pixelsPerHour = Math.min(32, (width - 40) / Math.max(1, taskDuration));
      }
      const duration = Math.min(taskDuration, (width - 40) / editor.pixelsPerHour);
      const center = task.start + duration / 2;
      editor.first = center - (buffer + width / 2) / editor.pixelsPerHour;
      refreshChart(buffer);
    } else refreshChart();
    const label = chart.querySelector(`[data-task-index="${task.index}"]`);
    const row = label.closest('.gantt-lane');
    const viewport = chart.getBoundingClientRect();
    const header = chart.querySelector('.gantt-header').offsetHeight;
    const bounds = row.getBoundingClientRect();
    if (bounds.top < viewport.top + header || bounds.bottom > viewport.bottom) {
      chart.scrollTop += bounds.top - viewport.top - header;
    }
    label.querySelector('input').focus({ preventScroll: true });
    return true;
  }
  const statusTimer = setInterval(updateScheduleStatus, 10_000);
  return {
    focusTask,
    cleanup() {
      clearInterval(statusTimer);
      scrollbars.cleanup();
    },
  };
}
