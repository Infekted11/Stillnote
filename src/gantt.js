import { addDatePickers, styleFormValidation } from './form-controls.js';
import { colors, day, ganttColorName, ganttInstanceRange, ganttInstances, ganttTaskColor, ganttTasks, hour, hourMs, hourValue, lastGanttInstanceNumber, numberGanttTasks, predecessors, primaryGanttInstanceNumber, removeGanttInstance, removeGanttTask } from '../electron/gantt-model.mjs';

export { ganttTasks, hourValue } from '../electron/gantt-model.mjs';

const tickIntervals = [1, 2, 4, 6, 12, 24, 48, 72, 168, 336, 672];
export const nowHour = (now = new Date()) => (now.getTime() - now.getTimezoneOffset() * 60_000) / hourMs;

const dateValue = value => hourValue(value).slice(0, 10);

export function ganttInstanceAt(row, source, cursorHour) {
  const range = ganttInstanceRange(source, row.milestone);
  const allDay = Number.isFinite(day(source.start)) || !Number.isFinite(range.start);
  const start = allDay ? Math.floor(cursorHour / 24) * 24 : Math.round(cursorHour * 4) / 4;
  const duration = Number.isFinite(range.start) ? range.end - range.start : 24;
  const from = allDay ? dateValue(start) : hourValue(start);
  return {
    number: lastGanttInstanceNumber(row) + 1,
    start: from,
    end: row.milestone ? from : allDay && Number.isFinite(day(source.end ?? dateValue(start)))
      ? dateValue(start + duration - 24) : hourValue(start + duration),
  };
}
export function ganttScheduleStatus(tasks, now) {
  let upcoming, upcomingStart = Infinity;
  for (const task of tasks) {
    if (task.children.length || task.progress === 100) continue;
    for (const range of task.ranges) {
      if (range.start <= now && now < range.end) return { label: 'Happening now', task, range };
      if (range.start >= now && range.start < upcomingStart) {
        upcoming = { label: 'Upcoming', task, range };
        upcomingStart = range.start;
      }
    }
  }
  return upcoming ?? null;
}

function visibleTasks(tasks, collapsed, query) {
  const matches = new Set();
  if (query) {
    for (const task of tasks) {
      if (!String(task.row.title ?? '').toLocaleLowerCase().includes(query) && task.displayNumber !== query) continue;
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

function wireTaskDrag(handle, bar, track, edge, row, instance, number, draw, editor) {
  const initial = () => ganttInstanceRange(instance, row.milestone, number);
  const adjust = (range, delta) => {
    if (edge === 'move') return { start: range.start + delta, end: range.end + delta };
    const duration = Math.min(editor.snap(instance), range.end - range.start);
    if (edge === 'start') return { ...range, start: Math.min(range.end - duration, range.start + delta) };
    return { ...range, end: Math.max(range.start + duration, range.end + delta) };
  };
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    editor.resizeTask(row, instance, number, adjust(initial(), delta * (event.shiftKey ? 24 : editor.snap(instance))), edge);
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
      const snap = editor.snap(instance);
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
      if (next.start !== range.start || next.end !== range.end) editor.resizeTask(row, instance, number, next, edge, false);
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

export function ganttDependencyPaths(from, to, y1, y2) {
  const bend = from + Math.max(12, (to - from) / 2);
  const mid = (y1 + y2) / 2;
  const line = to - from > 25
    ? `M${from},${y1} H${bend} V${y2} H${to}`
    : `M${from},${y1} H${bend} V${mid} H${to - 12} V${y2} H${to}`;
  return { line, arrow: `M${to},${y2} l-7,-4 v8 z` };
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
      const shapes = ganttDependencyPaths(from, to, y1, y2);
      path.setAttribute('d', shapes.line);
      arrow.setAttribute('d', shapes.arrow);
    }
  };
  update();
  return { svg, update };
}

export function renderGanttTimeline(rows, editor, tasks = ganttTasks(rows).ordered) {
  const layout = ganttLayout(rows, editor, tasks);
  const timeline = element('div', 'gantt-timeline');
  if (!layout) {
    timeline.textContent = 'Add a task with dates to start the timeline.';
    return timeline;
  }
  const numberWidth = tasks.reduce((width, task) => Math.max(width, task.displayNumber.length), 0);
  if (numberWidth > 2) timeline.style.setProperty('--gantt-id-width', `clamp(34px, ${numberWidth + 2}ch, 88px)`);
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
    const { row, index, number, displayNumber, depth, children, ranges, progress } = task;
    const lane = element('div', 'gantt-lane');
    const label = element('div', 'gantt-task-label');
    label.dataset.taskIndex = String(index);
    if (children.length) lane.classList.add('is-summary');
    const isLinked = editor?.linkedTaskNumber === number;
    lane.classList.toggle('is-linked-task', isLinked);
    const taskName = () => row.title || 'Untitled task';
    if (editor) {
      const grip = actionButton('gantt-grip', `Reorder ${taskName()}`, '⠿');
      editor.wireReorder(grip, label, task);
      label.append(grip);
      lane.addEventListener('contextmenu', event => {
        event.preventDefault();
        editor.openMenu(task, event.clientX, event.clientY, null, track.contains(event.target) ? track : null);
      });
    }
    const taskId = element('span', 'gantt-row-id', displayNumber);
    taskId.title = `Task ${displayNumber}`;
    label.append(taskId);
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
    const redrawBars = [];
    if (editor) {
      name.type = 'text';
      name.maxLength = 200;
      name.placeholder = 'Untitled task';
      name.value = row.title ?? '';
      name.setAttribute('aria-label', `Task ${displayNumber} name`);
      name.addEventListener('input', () => {
        row.title = name.value;
        editor.onChange();
        editor.updateScheduleStatus();
        redrawBars.forEach(redraw => redraw());
      });
      name.addEventListener('keydown', event => { if (event.key === 'Enter') name.blur(); });
    } else name.textContent = taskName();
    nameCell.append(name);
    label.append(nameCell);
    if (editor) {
      const actions = actionButton('gantt-task-actions', `Actions for task ${displayNumber}`, '⋮');
      actions.addEventListener('click', () => {
        const bounds = actions.getBoundingClientRect();
        editor.openMenu(task, bounds.right, bounds.bottom);
      });
      label.append(actions);
    }
    lane.append(label);

    const track = element('div', 'gantt-track');
    const positionsByInstance = new Map(ranges.map(range => [range.number, range]));
    if (ranges.length) positions.set(task, { start: task.start, end: task.end });
    for (const occurrence of ranges) {
      const { instance, number: instanceNumber } = occurrence;
      const bar = element('div', 'gantt-bar');
      bar.dataset.barIndex = String(index);
      if (instanceNumber !== null) bar.dataset.instanceNumber = String(instanceNumber);
      bar.classList.toggle('is-linked-instance', isLinked && (editor.linkedInstanceNumber == null || editor.linkedInstanceNumber === instanceNumber));
      bar.classList.toggle('is-milestone', Boolean(row.milestone));
      bar.style.setProperty('--gantt-bar-color', ganttTaskColor(task));
      const fill = element('span', 'gantt-bar-fill');
      bar.append(fill);
      const button = editor ? actionButton('gantt-bar-body', taskName(), '') : element('span', 'gantt-bar-body');
      if (!editor) button.setAttribute('role', 'img');
      bar.append(button);
      const draw = (changedRange) => {
        if (changedRange) {
          positionsByInstance.set(instanceNumber, changedRange);
          const positionsForTask = [...positionsByInstance.values()];
          positions.set(task, {
            start: Math.min(...positionsForTask.map(item => item.start)),
            end: Math.max(...positionsForTask.map(item => item.end)),
          });
        }
        const range = positionsByInstance.get(instanceNumber);
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
        const identity = instanceNumber == null ? `Task ${displayNumber}` : `Task ${displayNumber}, instance ${instanceNumber}`;
        bar.title = `${identity} · ${taskName()} · ${dates}${row.milestone ? '' : ` · ${Math.round(progress)}%`}`;
        button.title = bar.title;
        button.setAttribute('aria-label', bar.title);
        dependencies?.update();
      };
      redrawBars.push(draw);
      draw();
      if (editor) {
        bar.addEventListener('contextmenu', event => {
          event.preventDefault();
          event.stopPropagation();
          editor.openMenu(task, event.clientX, event.clientY, instanceNumber, track);
        });
        const editBar = () => instance ? editor.editInstance(task, occurrence) : editor.editTask(row);
        button.addEventListener('dblclick', editBar);
        button.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          editBar();
        });
        if (instance) {
          button.classList.add('is-move');
          wireTaskDrag(button, bar, track, 'move', row, instance, instanceNumber, draw, editor);
          if (!row.milestone) {
            for (const edge of ['start', 'end']) {
              const handle = actionButton(`gantt-handle is-${edge}`, `Resize task ${edge}`, '');
              bar.append(handle);
              wireTaskDrag(handle, bar, track, edge, row, instance, instanceNumber, draw, editor);
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

export function renderGanttEditor(root, data, { icons, tasksApi, onChange, onHistory, copyTaskLink, exportPng }) {
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
      <button type="button" data-export-png title="Export PNG" aria-label="Export PNG">${icons.download}</button>
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
    <div class="canvas-color-palette gantt-color-menu" popover="manual" aria-label="Task actions"></div>
    <dialog class="gantt-instance-dialog rename-dialog" aria-labelledby="gantt-instance-heading">
      <form method="dialog">
        <h3 id="gantt-instance-heading"></h3>
        <label>Start<input class="settings-input" name="start" required autofocus></label>
        <label>End<input class="settings-input" name="end" required></label>
        <div class="rename-actions"><button class="secondary-button" type="button" data-cancel title="Cancel" aria-label="Cancel">${icons.close}</button><button class="primary-button" value="save" title="Save instance" aria-label="Save instance">${icons.statusCheck}</button></div>
      </form>
    </dialog>
    <dialog class="gantt-details rename-dialog" aria-labelledby="gantt-details-heading">
      <form method="dialog">
        <h3 id="gantt-details-heading"></h3>
        <label>Task name<input class="settings-input" name="title" maxlength="200" required data-required-message="Enter a task name." autofocus></label>
        <label>Details<input class="settings-input" name="notes" maxlength="500" placeholder="Optional"></label>
        <div class="gantt-checks">
          <label><input class="stillnote-checkbox" type="checkbox" name="allDay"> All day</label>
          <label><input class="stillnote-checkbox" type="checkbox" name="milestone"> Milestone</label>
        </div>
        <span data-primary-instance></span>
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
        <fieldset class="gantt-instances" hidden><legend>Additional instances</legend><div data-instances></div><button class="secondary-button" type="button" data-add-instance>Add instance</button></fieldset>
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
  const dismissMenu = event => {
    if (!menu.matches(':popover-open')) return;
    if (event.type === 'keydown') {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
    } else if (event.composedPath().includes(menu)) return;
    menu.hidePopover();
  };
  document.addEventListener('pointerdown', dismissMenu, true);
  document.addEventListener('keydown', dismissMenu, true);
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
  const exportButton = toolbar.querySelector('[data-export-png]');
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try { await exportPng(); }
    finally { exportButton.disabled = false; }
  });
  const details = surface.querySelector('.gantt-details');
  const form = details.querySelector('form');
  addDatePickers(form, icons.ganttToday);
  styleFormValidation(form);
  styleFormValidation(picker.querySelector('form'));
  const { title, notes, start, end, startTime, endTime, allDay, milestone, progress, parent } = form.elements;
  details.querySelector('[data-cancel]').addEventListener('click', () => details.close());
  const predecessorList = details.querySelector('.gantt-predecessors div');
  const instanceFields = details.querySelector('.gantt-instances');
  const instanceList = details.querySelector('[data-instances]');
  const primaryInstanceLabel = details.querySelector('[data-primary-instance]');
  let instanceEdits = [], lastInstanceNumber = 1;
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
    editInstance,
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
    status.hidden = !next;
    if (!next) return;
    const name = next.task.row.title?.trim() || 'Untitled task';
    const title = next.task.ranges.length > 1 || next.range.number > 1 ? `${name} · Instance ${next.range.number}` : name;
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
      if (task.index >= Math.min(from, to) && task.index <= Math.max(from, to)) task.row.color ??= ganttColorName(task.row, task.index);
    }
    data.rows.splice(from, 1);
    data.rows.splice(to, 0, source.row);
    save();
    chart.querySelector(`[data-task-index="${to}"] .gantt-grip`)?.focus({ preventScroll: true });
  }

  function persistTaskNumbers() {
    numberGanttTasks(data, model);
  }
  function save() {
    model = ganttTasks(data.rows, data.lastTaskNumber);
    persistTaskNumbers();
    onChange();
    refreshChart();
  }
  function resizeTask(row, instance, number, range, edge, focus = true) {
    const startDateOnly = Number.isFinite(day(instance.start));
    const endDateOnly = Number.isFinite(day(instance.end));
    instance.start = startDateOnly && range.start % 24 === 0 ? dateValue(range.start) : hourValue(range.start);
    instance.end = row.milestone ? instance.start : endDateOnly && range.end % 24 === 0 ? dateValue(range.end - 24) : hourValue(range.end);
    save();
    if (focus) {
      const index = data.rows.indexOf(row);
      const handle = edge === 'move' ? '.gantt-bar-body' : `.gantt-handle.is-${edge}`;
      chart.querySelector(`[data-bar-index="${index}"][data-instance-number="${number}"] ${handle}`)?.focus({ preventScroll: true });
    }
  }
  const instanceDialog = surface.querySelector('.gantt-instance-dialog');
  const instanceForm = instanceDialog.querySelector('form');
  const { start: instanceStart, end: instanceEnd } = instanceForm.elements;
  let selectedInstance;
  styleFormValidation(instanceForm);
  instanceDialog.querySelector('[data-cancel]').addEventListener('click', () => instanceDialog.close());
  for (const input of [instanceStart, instanceEnd]) {
    input.addEventListener('input', () => instanceEnd.setCustomValidity(''));
  }
  function editInstance(task, { instance, number }) {
    const { row } = task;
    selectedInstance = { row, instance, number };
    instanceDialog.querySelector('h3').textContent = `Task ${task.displayNumber}, instance ${number}`;
    instanceStart.type = Number.isFinite(day(instance.start)) ? 'date' : 'datetime-local';
    instanceEnd.type = Number.isFinite(day(instance.end)) ? 'date' : 'datetime-local';
    instanceStart.value = instance.start;
    instanceEnd.value = instance.end ?? '';
    instanceEnd.disabled = instanceEnd.parentElement.hidden = Boolean(row.milestone);
    instanceEnd.setCustomValidity('');
    instanceDialog.showModal();
  }
  instanceForm.addEventListener('submit', event => {
    event.preventDefault();
    const { row, instance, number } = selectedInstance;
    const candidate = { start: instanceStart.value, end: row.milestone ? instanceStart.value : instanceEnd.value };
    if (!Number.isFinite(ganttInstanceRange(candidate, row.milestone).start)) {
      instanceEnd.setCustomValidity('End must be after the start time.');
      instanceEnd.reportValidity();
      return;
    }
    Object.assign(instance, candidate);
    instanceDialog.close();
    save();
    chart.querySelector(`[data-bar-index="${data.rows.indexOf(row)}"][data-instance-number="${number}"] .gantt-bar-body`)?.focus({ preventScroll: true });
  });
  function addRow(row) {
    row.color ??= ganttColorName(row, data.rows.length);
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
    for (const edit of instanceEdits) {
      edit.end.disabled = milestone.checked;
      edit.end.parentElement.hidden = milestone.checked;
      edit.end.setCustomValidity('');
    }
  }
  function addInstanceFields({ number, start: from, end: to }, focus = false) {
    const fields = element('div', 'gantt-instance');
    const header = element('div', 'gantt-instance-header');
    header.append(element('strong', '', `Instance ${number}`));
    const remove = actionButton('secondary-button gantt-icon-button', `Remove instance ${number}`, icons.trash);
    header.append(remove);
    const dates = element('div', 'gantt-date-fields');
    const timed = Number.isFinite(hour(from)) && !Number.isFinite(day(from));
    const input = (label, value) => {
      const container = element('label', '', label);
      const control = element('input', 'settings-input');
      control.type = timed ? 'datetime-local' : 'date';
      control.value = value;
      control.required = true;
      container.append(control);
      dates.append(container);
      return control;
    };
    const first = input('Start', from);
    const last = input('End', to);
    const edit = { number, start: first, end: last };
    const timing = element('label', 'gantt-instance-timing', 'Timed instance');
    const timedToggle = element('input', 'stillnote-checkbox');
    timedToggle.type = 'checkbox';
    timedToggle.checked = timed;
    timing.prepend(timedToggle);
    timedToggle.addEventListener('change', () => {
      const from = hour(first.value), to = hour(last.value, true);
      first.type = last.type = timedToggle.checked ? 'datetime-local' : 'date';
      if (Number.isFinite(from)) first.value = timedToggle.checked ? hourValue(from) : dateValue(from);
      if (Number.isFinite(to)) last.value = timedToggle.checked ? hourValue(to) : dateValue(to > from && to % 24 === 0 ? to - 24 : to);
      last.setCustomValidity('');
    });
    for (const control of [first, last]) control.addEventListener('input', () => last.setCustomValidity(''));
    remove.addEventListener('click', () => {
      instanceEdits = instanceEdits.filter(item => item !== edit);
      fields.remove();
      instanceList.nextElementSibling.focus();
    });
    fields.append(header, dates, timing);
    instanceList.append(fields);
    instanceEdits.push(edit);
    updateDateFields();
    if (focus) first.focus();
  }
  function addInstance() {
    if (lastInstanceNumber >= Number.MAX_SAFE_INTEGER) return;
    const previous = instanceEdits.at(-1);
    const isTimed = previous ? previous.start.type === 'datetime-local' : !allDay.checked;
    const from = previous?.start.value || (isTimed ? `${start.value}T${startTime.value}` : start.value);
    const to = previous?.end.value || (isTimed ? `${end.value}T${endTime.value}` : end.value);
    const range = ganttInstanceRange({ start: from, end: to }, milestone.checked);
    const duration = Number.isFinite(range.start) ? range.end - range.start : 0;
    const nextStart = (Number.isFinite(range.start) ? range.start : hour(today())) + Math.max(24, Math.ceil(duration / 24) * 24);
    const nextEnd = nextStart + duration;
    addInstanceFields({
      number: ++lastInstanceNumber,
      start: isTimed ? hourValue(nextStart) : dateValue(nextStart),
      end: isTimed ? hourValue(milestone.checked ? nextStart + 1 : Math.max(nextStart + 1, nextEnd))
        : dateValue(milestone.checked ? nextStart : Math.max(nextStart, nextEnd - 24)),
    }, true);
  }
  details.querySelector('[data-add-instance]').addEventListener('click', addInstance);
  allDay.addEventListener('change', () => {
    if (!allDay.checked && end.value && endTime.value === '00:00' && !milestone.checked) {
      end.value = dateValue(hour(end.value, true));
    } else if (allDay.checked && end.value && endTime.value === '00:00' && end.value > start.value) {
      end.value = dateValue(hour(end.value) - 24);
    }
    updateDateFields();
  });
  milestone.addEventListener('change', updateDateFields);
  function editTask(row, suggestedParent = null, { instanceNumber } = {}) {
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
    const primaryNumber = primaryGanttInstanceNumber(row ?? {});
    primaryInstanceLabel.hidden = Boolean(summary);
    primaryInstanceLabel.textContent = `Instance ${primaryNumber}`;
    instanceFields.hidden = Boolean(task?.children.length);
    instanceFields.disabled = instanceFields.hidden;
    instanceList.replaceChildren();
    instanceEdits = [];
    lastInstanceNumber = lastGanttInstanceNumber(row ?? {});
    if (!instanceFields.hidden && row) {
      for (const { instance } of ganttInstances(row).slice(1)) addInstanceFields(instance);
    }
    end.setCustomValidity('');
    endTime.setCustomValidity('');
    progress.value = Math.round(task?.progress ?? 0);
    parent.replaceChildren(new Option('None', ''));
    predecessorList.replaceChildren();
    const taskLabel = item => `${item.displayNumber} · ${item.row.title || 'Untitled task'}`;
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
    if (instanceNumber === primaryNumber) start.focus();
    else instanceEdits.find(edit => edit.number === instanceNumber)?.start.focus();
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
    const instances = [];
    for (const edit of instanceEdits) {
      const instance = { number: edit.number, start: edit.start.value, end: milestone.checked ? edit.start.value : edit.end.value };
      if (!Number.isFinite(ganttInstanceRange(instance, milestone.checked).start)) {
        edit.end.setCustomValidity('End must be after the start time.');
        edit.end.reportValidity();
        return;
      }
      instances.push(instance);
    }
    const addedOccurrence = instances.some(instance => instance.number > lastGanttInstanceNumber(row));
    row.title = title.value.trim() || 'Untitled task';
    if (notes.value.trim() || row.notes || row.description) row.notes = notes.value.trim();
    if (!start.disabled) {
      row.start = startValue;
      row.end = milestone.checked ? startValue : endValue;
      row.milestone = milestone.checked;
    }
    if (!instanceFields.disabled && (instances.length || Array.isArray(row.instances))) {
      row.instances = instances;
      row.lastInstanceNumber = lastInstanceNumber;
    }
    if (!progress.disabled) row.progress = Number(progress.value);
    const group = parent.value === '' ? null : data.rows[Number(parent.value)];
    if (group) {
      row.parentId = ensureId(group);
      editor.collapsed.delete(row.parentId);
    } else delete row.parentId;
    row.predecessors = Array.from(predecessorList.querySelectorAll('input:checked'), checkbox => ensureId(data.rows[Number(checkbox.value)]));
    details.close('save');
    if (editingTask) {
      save();
      if (addedOccurrence) zoomToFit();
    }
    else addRow(row);
  });

  function openMenu(task, x, y, instanceNumber, track) {
    const { row } = task;
    const bounds = track?.getBoundingClientRect();
    const atCursor = bounds && x >= bounds.left && x <= bounds.right;
    const source = task.ranges.find(range => range.number === instanceNumber)?.instance ?? row;
    const cursorHour = atCursor ? editor.first + (x - bounds.left) / editor.pixelsPerHour
      : Math.max(nowHour(), Number.isFinite(task.end) ? Math.ceil(task.end / 24) * 24 : -Infinity);
    if (menu.matches(':popover-open')) menu.hidePopover();
    menu.replaceChildren();
    const palette = document.createElement('div');
    palette.className = 'gantt-swatch-grid';
    for (const [name, value] of task.parent ? [] : Object.entries(colors)) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'canvas-color-swatch';
      swatch.style.setProperty('--swatch', value);
      swatch.title = name;
      swatch.setAttribute('aria-label', `${name} color`);
      const active = ganttColorName(row, task.index) === name;
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
    if (palette.childElementCount) menu.append(palette);
    const actions = element('div', 'gantt-menu-actions');
    menu.append(actions);
    const action = (label, icon, run) => {
      const button = actionButton('secondary-button gantt-icon-button', label, icon);
      button.addEventListener('click', () => { menu.hidePopover(); run(); });
      actions.append(button);
    };
    action('Edit task', icons.ganttEdit, () => editTask(row, null, { instanceNumber }));
    if (!task.children.length && lastGanttInstanceNumber(row) < Number.MAX_SAFE_INTEGER) {
      const add = element('button', 'secondary-button', 'Add instance');
      add.type = 'button';
      add.addEventListener('click', () => {
        menu.hidePopover();
        const instance = ganttInstanceAt(row, source, cursorHour);
        row.instances = [...(Array.isArray(row.instances) ? row.instances : []), instance];
        row.lastInstanceNumber = instance.number;
        save();
        if (!atCursor) focusTask(task.number, instance.number);
      });
      actions.append(add);
    }
    if (!row.milestone) action('Add subtask', icons.folderPlus, () => editTask(null, row));
    const isInstance = instanceNumber != null;
    action(isInstance ? 'Copy instance link' : 'Copy task link', icons.duplicate, async () => {
      try {
        await copyTaskLink(task.number, instanceNumber);
        if (root.isConnected) status.textContent = isInstance ? 'Instance link copied.' : 'Task link copied.';
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
    const removeInstance = isInstance && ganttInstances(row).length > 1;
    action(removeInstance ? 'Remove instance' : 'Remove task', icons.trash, () => {
      if (removeInstance) removeGanttInstance(row, instanceNumber);
      else {
        removeGanttTask(data.rows, task);
        editor.collapsed.delete(row.id);
      }
      save();
    });
    menu.showPopover();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    (palette.querySelector('.active') ?? actions.querySelector('button'))?.focus({ preventScroll: true });
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
  function focusTask(number, instanceNumber = null) {
    const task = model.numbered.get(number);
    if (!task || editor.dragging) return false;
    const range = instanceNumber === null ? task : task.ranges.find(item => item.number === instanceNumber);
    if (!range) return false;
    editor.linkedTaskNumber = number;
    editor.linkedInstanceNumber = instanceNumber;
    search.value = editor.searching = '';
    for (let group = task.parent; group; group = group.parent) editor.collapsed.delete(group.row.id);
    if (Number.isFinite(range.start)) {
      const width = availableWidth();
      const taskDuration = range.end - range.start;
      if (taskDuration < 24 && !Number.isFinite(day((range.instance ?? task.row).start))) {
        editor.pixelsPerHour = Math.min(32, (width - 40) / Math.max(1, taskDuration));
      }
      const duration = Math.min(taskDuration, (width - 40) / editor.pixelsPerHour);
      const center = range.start + duration / 2;
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
    const bar = instanceNumber === null ? null : row.querySelector(`[data-instance-number="${instanceNumber}"] .gantt-bar-body`);
    (bar ?? label.querySelector('input')).focus({ preventScroll: true });
    return true;
  }
  const statusTimer = setInterval(updateScheduleStatus, 10_000);
  return {
    focusTask,
    cleanup() {
      document.removeEventListener('pointerdown', dismissMenu, true);
      document.removeEventListener('keydown', dismissMenu, true);
      clearInterval(statusTimer);
      scrollbars.cleanup();
    },
  };
}
