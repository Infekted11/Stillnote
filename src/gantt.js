const dayMs = 86_400_000;
const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / dayMs : NaN;
}

const hourMs = dayMs / 24;
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const colors = {
  Lavender: '#cdc1eb', Peach: '#f3c7b1', Mint: '#bde0cd',
  Sky: '#b9d9ee', Rose: '#edbfd2', Butter: '#f1e2a8',
  Lilac: '#e1c1e8', Coral: '#f4bdb7', Sage: '#d4dfb5',
  Aqua: '#b4e2de', Periwinkle: '#bcc9f4', Sand: '#e8d2bb',
};
const colorNames = Object.keys(colors);

function hour(value, end = false) {
  if (Number.isFinite(day(value))) return day(value) * 24 + (end ? 24 : 0);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return NaN;
  const timestamp = Date.parse(`${value}Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp / hourMs : NaN;
}

const hourValue = (value) => new Date(Math.round(value * hourMs)).toISOString().slice(0, 16);

const tickIntervals = [0.25, 0.5, 1, 2, 4, 6, 12, 24, 48, 72, 168, 336, 672];
const nowHour = () => {
  const now = new Date();
  return (now.getTime() - now.getTimezoneOffset() * 60_000) / hourMs;
};

export function ganttLayout(rows, viewport) {
  const bars = rows.map(row => ({ row, start: hour(row.start), end: hour(row.end, true) }))
    .filter(({ start, end }) => Number.isFinite(start) && end > start);
  if (viewport) {
    const { first, pixelsPerHour, width } = viewport;
    const step = tickIntervals.find(interval => interval * pixelsPerHour >= 76) ?? 1344;
    return { first, last: first + width / pixelsPerHour, step, bars };
  }
  if (!bars.length) return null;
  const min = bars.reduce((value, bar) => Math.min(value, bar.start), Infinity);
  const max = bars.reduce((value, bar) => Math.max(value, bar.end), -Infinity);
  const step = tickIntervals.find(interval => (max - min) / interval <= 5)
    ?? Math.ceil((max - min) / (5 * 672)) * 672;
  const first = Math.floor(min / step) * step - step;
  const last = Math.ceil(max / step) * step + step;
  return { first, last, step, bars };
}

function wireTaskDrag(handle, bar, track, edge, row, draw, editor) {
  const initial = () => ({ start: hour(row.start), end: hour(row.end, true) });
  const adjust = (range, delta) => {
    if (edge === 'move') return { start: range.start + delta, end: range.end + delta };
    if (edge === 'start') return { ...range, start: Math.min(range.end - Math.min(1, range.end - range.start), range.start + delta) };
    return { ...range, end: Math.max(range.start + Math.min(1, range.end - range.start), range.end + delta) };
  };
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    editor.resizeTask(row, adjust(initial(), delta * (event.shiftKey ? 24 : 1)), edge);
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
      const snap = editor.pixelsPerHour >= 24 ? 0.25 : 1;
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
      if (next.start !== range.start || next.end !== range.end) editor.resizeTask(row, next);
      else draw(range);
      editor.onDragEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
}

export function renderGanttTimeline(rows, editor, layout = ganttLayout(rows)) {
  const timeline = document.createElement('div');
  timeline.className = 'gantt-timeline';
  if (!layout) {
    timeline.textContent = 'Add a task with dates to start the timeline.';
    return timeline;
  }
  const { first, last, step } = layout;
  if (editor) {
    timeline.classList.add('is-scrollable');
    timeline.style.setProperty('--gantt-track-width', `${editor.width}px`);
  }
  const percent = value => (value - first) / (last - first) * 100;
  const grid = document.createElement('div');
  grid.className = 'gantt-grid';
  for (let tick = Math.ceil(first / step) * step; tick <= last; tick += step) {
    const line = document.createElement('span');
    line.className = 'gantt-grid-line';
    line.classList.toggle('is-first', tick === first);
    line.classList.toggle('is-last', tick === last);
    line.style.left = `${percent(tick)}%`;
    const label = document.createElement('span');
    label.className = 'gantt-tick';
    label.textContent = dateLabel.format(tick * hourMs);
    const time = document.createElement('small');
    time.textContent = timeLabel.format(tick * hourMs);
    label.append(time);
    line.append(label);
    grid.append(line);
  }
  if (editor && first <= editor.now && editor.now <= last) {
    const marker = document.createElement('span');
    marker.className = 'gantt-now-marker';
    marker.style.left = `${percent(editor.now)}%`;
    marker.title = 'Now';
    grid.append(marker);
  }
  timeline.append(grid);
  for (const { row, start, end } of layout.bars) {
    const lane = document.createElement('div');
    lane.className = 'gantt-lane';
    const index = rows.indexOf(row);
    const name = document.createElement(editor ? 'input' : 'span');
    name.className = 'gantt-lane-name';
    const taskName = () => row.title || 'Untitled task';
    if (editor) {
      name.type = 'text';
      name.maxLength = 200;
      name.placeholder = 'Untitled task';
      name.value = row.title ?? '';
      name.dataset.taskIndex = String(index);
      name.setAttribute('aria-label', 'Task name');
      name.addEventListener('input', () => {
        row.title = name.value;
        editor.onChange();
        draw({ start, end });
      });
      name.addEventListener('keydown', event => {
        if (event.key === 'Enter') name.blur();
      });
    } else name.textContent = taskName();
    if (editor) {
      const label = document.createElement('div');
      label.className = 'gantt-sticky-label';
      label.append(name);
      lane.append(label);
    } else lane.append(name);
    const track = document.createElement('span');
    track.className = 'gantt-track';
    const bar = document.createElement('span');
    bar.className = 'gantt-bar';
    bar.dataset.barIndex = String(index);
    bar.classList.toggle('is-complete', row.googleTask?.status === 'completed');
    bar.style.backgroundColor = colors[row.color] ?? colors[colorNames[index % colorNames.length]];
    const body = document.createElement(editor ? 'button' : 'span');
    body.className = 'gantt-bar-body';
    bar.append(body);
    if (editor) {
      body.type = 'button';
      body.classList.add('is-move');
      lane.addEventListener('contextmenu', event => {
        event.preventDefault();
        editor.openMenu(row, event.clientX, event.clientY);
      });
      body.addEventListener('keydown', event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const bounds = body.getBoundingClientRect();
        editor.openMenu(row, bounds.left, bounds.bottom);
      });
    } else body.setAttribute('role', 'img');
    const draw = (range) => {
      bar.hidden = range.end <= first || range.start >= last;
      bar.style.left = `${Math.max(0, percent(range.start))}%`;
      bar.style.width = `${Math.max(0, Math.min(100, percent(range.end)) - Math.max(0, percent(range.start)))}%`;
      bar.title = `${taskName()} · ${hourValue(range.start).replace('T', ' ')} to ${hourValue(range.end).replace('T', ' ')}`;
      bar.dataset.dragLabel = `${hourValue(range.start).replace('T', ' ')} – ${hourValue(range.end).replace('T', ' ')}`;
      body.setAttribute('aria-label', editor ? `Move ${bar.title}` : bar.title);
    };
    draw({ start, end });
    if (editor) {
      wireTaskDrag(body, bar, track, 'move', row, draw, editor);
      for (const edge of ['start', 'end']) {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = `gantt-handle is-${edge}`;
        handle.setAttribute('aria-label', `Resize task ${edge}`);
        handle.title = `Drag to change ${edge} time`;
        bar.append(handle);
        wireTaskDrag(handle, bar, track, edge, row, draw, editor);
      }
    }
    track.append(bar);
    lane.append(track);
    timeline.append(lane);
  }
  return timeline;
}

export function renderGanttEditor(root, data, { icons, tasksApi, onChange, onHistory }) {
  if (!Array.isArray(data.rows)) data.rows = [];
  data.rows.forEach((row, index) => { row.color ??= colorNames[index % colorNames.length]; });
  const toolbar = root.querySelector('.structured-toolbar');
  const surface = root.querySelector('.structured-surface');
  toolbar.innerHTML = `
    <button class="gantt-toolbar-icon" type="button" data-add title="Add task" aria-label="Add task">${icons.add}</button>
    <button class="gantt-toolbar-icon" type="button" data-google title="Link Google Task" aria-label="Link Google Task">${icons.link}</button>
    <button class="gantt-toolbar-icon" type="button" data-history="undo" title="Undo" aria-label="Undo">${icons.undo}</button>
    <button class="gantt-toolbar-icon" type="button" data-history="redo" title="Redo" aria-label="Redo">${icons.redo}</button>
    <span role="status"></span>
    <div class="gantt-zoom" role="group" aria-label="Timeline zoom">
      <button class="gantt-toolbar-icon" type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${icons.zoomOut}</button>
      <button class="gantt-toolbar-icon" type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${icons.zoomIn}</button>
    </div>`;
  surface.innerHTML = '<div class="gantt-chart" tabindex="0" role="region" aria-label="Scrollable Gantt timeline"></div><div class="canvas-color-palette gantt-color-menu" popover aria-label="Task actions"></div><dialog class="gantt-picker rename-dialog"><form method="dialog"><h3>Link Google Task</h3><label>Task list<select class="settings-input" data-list required></select></label><label>Task<select class="settings-input" data-task required></select></label><p role="status"></p><div class="rename-actions"><button class="secondary-button" value="cancel" formnovalidate>Cancel</button><button class="primary-button" value="link" disabled>Link task</button></div></form></dialog>';
  const chart = surface.querySelector('.gantt-chart');
  const menu = surface.querySelector('.gantt-color-menu');
  const status = toolbar.querySelector('[role=status]');
  const picker = surface.querySelector('.gantt-picker');
  const listSelect = picker.querySelector('[data-list]');
  const taskSelect = picker.querySelector('[data-task]');
  const pickerStatus = picker.querySelector('[role=status]');
  const linkButton = picker.querySelector('[value=link]');
  const zoomLevels = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];
  let zoomIndex = zoomLevels.indexOf(8);
  const buffer = 6000;
  let repaintPending = false;
  const editor = {
    first: nowHour() - (buffer + 16) / zoomLevels[zoomIndex],
    pixelsPerHour: zoomLevels[zoomIndex],
    width: buffer * 2,
    dragging: false,
    onChange,
    resizeTask,
    openMenu,
    onDragEnd() {
      if (repaintPending) refreshChart();
      extendScroll();
    },
  };
  function refreshChart(scroll = chart.scrollLeft) {
    if (editor.dragging) { repaintPending = true; return; }
    repaintPending = false;
    editor.now = nowHour();
    const layout = ganttLayout(data.rows, editor);
    chart.replaceChildren(renderGanttTimeline(data.rows, editor, layout));
    chart.scrollLeft = scroll;
  }
  function extendScroll() {
    if (editor.dragging) return;
    const scroll = chart.scrollLeft;
    const max = chart.scrollWidth - chart.clientWidth;
    if (max <= 0 || (scroll >= 750 && max - scroll >= 750)) return;
    editor.first += (scroll - buffer) / editor.pixelsPerHour;
    refreshChart(buffer);
  }
  chart.addEventListener('scroll', extendScroll);
  const labelWidth = () => chart.querySelector('.gantt-sticky-label')?.offsetWidth
    ?? parseFloat(getComputedStyle(chart.querySelector('.gantt-grid')).left) - 12;
  const zoomOut = toolbar.querySelector('[data-zoom=out]');
  const zoomIn = toolbar.querySelector('[data-zoom=in]');
  function zoom(direction) {
    const next = zoomIndex + direction;
    if (editor.dragging || next < 0 || next >= zoomLevels.length) return;
    const center = Math.max(0, chart.clientWidth - labelWidth()) / 2;
    const anchor = editor.first + (chart.scrollLeft + center) / editor.pixelsPerHour;
    zoomIndex = next;
    editor.pixelsPerHour = zoomLevels[next];
    editor.first = anchor - (buffer + center) / editor.pixelsPerHour;
    refreshChart(buffer);
    zoomOut.disabled = next === 0;
    zoomIn.disabled = next === zoomLevels.length - 1;
  }
  zoomOut.addEventListener('click', () => zoom(-1));
  zoomIn.addEventListener('click', () => zoom(1));
  const save = () => { onChange(); refreshChart(); };
  function resizeTask(row, range, focusEdge) {
    row.start = hourValue(range.start);
    row.end = hourValue(range.end);
    save();
    if (focusEdge) {
      const index = data.rows.indexOf(row);
      chart.querySelector(`[data-bar-index="${index}"] .is-${focusEdge}`)?.focus();
    }
  }
  const addRow = (row) => {
    row.color = colorNames[data.rows.length % colorNames.length];
    data.rows.push(row);
    const start = hour(row.start);
    const left = editor.first + chart.scrollLeft / editor.pixelsPerHour;
    if (start < left || start > left + Math.max(0, chart.clientWidth - labelWidth() - 24) / editor.pixelsPerHour) {
      editor.first = start - (buffer + 16) / editor.pixelsPerHour;
      onChange();
      refreshChart(buffer);
    } else save();
    const name = chart.querySelector(`[data-task-index="${data.rows.length - 1}"]`);
    name?.focus();
    name?.select();
  };
  const today = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
  };
  function openMenu(row, x, y) {
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
      swatch.setAttribute('aria-pressed', String(row.color === name));
      swatch.classList.toggle('active', row.color === name);
      swatch.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.8"/></svg>';
      swatch.addEventListener('click', () => {
        row.color = name;
        menu.hidePopover();
        save();
      });
      palette.append(swatch);
    }
    menu.append(palette);
    const action = (label, run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = label;
      button.addEventListener('click', () => { menu.hidePopover(); run(); });
      menu.append(button);
    };
    if (row.googleTask) {
      const link = row.googleTask;
      const label = document.createElement('small');
      label.textContent = `${link.listTitle} / ${link.title}`;
      menu.append(label);
      action('Refresh Google Task', async () => {
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
      action('Unlink Google Task', () => { delete row.googleTask; save(); });
    } else action('Link Google Task', () => void openTaskPicker(row));
    action('Remove task', () => { data.rows.splice(data.rows.indexOf(row), 1); save(); });
    menu.showPopover();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    palette.querySelector('.active')?.focus();
  }
  for (const button of toolbar.querySelectorAll('[data-history]')) {
    button.addEventListener('click', () => onHistory(button.dataset.history));
  }
  toolbar.querySelector('[data-add]').addEventListener('click', () => {
    const start = Math.floor(nowHour() * 60) / 60;
    addRow({ title: 'New task', start: hourValue(start), end: hourValue(start + 1) });
  });
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
  refreshChart(buffer);
}
