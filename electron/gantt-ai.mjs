import { colors, ganttInstances, ganttTasks, hour, numberGanttTasks, predecessors, removeGanttTask } from './gantt-model.mjs';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseGanttDocument(text) {
  const match = /<!--\s*stillnote:type=gantt\s*-->[\s\S]*?\x60{3}stillnote-gantt[ \t]*\r?\n([\s\S]*?)\r?\n\x60{3}(?=[ \t]*\r?$)/dm.exec(text);
  if (!match) throw new Error('Choose a Stillnote Gantt chart.');
  let data;
  try { data = JSON.parse(match[1]); } catch { throw new Error('This Gantt chart contains invalid task data.'); }
  if (!isRecord(data) || !Array.isArray(data.rows) || !data.rows.every(isRecord)) {
    throw new Error('This Gantt chart contains invalid task data.');
  }
  const [start, end] = match.indices[1];
  return { data, start, end };
}

export function ganttTaskPage(data, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Use a valid task page offset.');
  const { ordered, byId } = ganttTasks(data.rows, data.lastTaskNumber);
  const tasks = ordered.slice(offset, offset + 50).map(({ row, number, displayNumber, children, parent, progress }) => {
    const notes = String(row.notes ?? row.description ?? '');
    return {
      number, displayNumber, title: row.title || 'Untitled task', start: row.start ?? null, end: row.end ?? null,
      progress: Math.round(progress), milestone: Boolean(row.milestone), summary: Boolean(children.length),
      parentNumber: parent?.number ?? null,
      predecessorNumbers: predecessors(row).map(id => byId.get(id)?.number).filter(Number.isSafeInteger),
      notes: notes.slice(0, 500), ...(notes.length > 500 ? { notesTruncated: true } : {}),
      color: row.color ?? null, linkedGoogleTask: Boolean(row.googleTask),
      ...(row.instances?.length ? { instances: ganttInstances(row).map(({ number, instance }) =>
        ({ number, start: instance.start, end: instance.end })) } : {}),
    };
  });
  const next = offset + tasks.length;
  return { tasks, nextOffset: next < ordered.length ? next : null };
}

function ensureId(row) {
  row.id ||= globalThis.crypto.randomUUID();
  return row.id;
}

function reaches(task, target, next) {
  const pending = [task];
  const visited = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (!item || visited.has(item)) continue;
    if (item.row === target) return true;
    visited.add(item);
    pending.push(...next(item));
  }
  return false;
}

function updateTask(row, change, model) {
  const oldStart = row.start;
  const oldEnd = row.end;
  const oldMilestone = Boolean(row.milestone);
  for (const field of ['title', 'notes', 'start', 'end', 'color']) {
    const value = change[field];
    if (value == null) continue;
    if (typeof value !== 'string') throw new Error('Expected text for ' + field + '.');
    if (field === 'title' && !value.trim()) throw new Error('Provide a task title.');
    if (field === 'color' && !Object.hasOwn(colors, value)) throw new Error('Choose a chart color from the Gantt palette.');
    if (['start', 'end'].includes(field) && !value) delete row[field];
    else row[field] = value.trim();
  }
  if (change.milestone != null) {
    if (typeof change.milestone !== 'boolean') throw new Error('Milestone must be true or false.');
    row.milestone = change.milestone;
  }
  const datesChanged = row.start !== oldStart || row.end !== oldEnd || Boolean(row.milestone) !== oldMilestone;
  if (datesChanged && row.milestone) {
    if (row.start) row.end = row.start;
    else delete row.end;
  }
  if (datesChanged && (row.start || row.end)) {
    const start = hour(row.start), end = hour(row.end, true);
    if (!Number.isFinite(start) || (!row.milestone && !(end > start))) {
      throw new Error('Use valid start and end dates with the end after the start, or provide a start date for a milestone.');
    }
  }

  if (change.progress != null) {
    if (!Number.isInteger(change.progress) || change.progress < 0 || change.progress > 100) {
      throw new Error('Progress must be a whole percentage from 0 to 100.');
    }
    if (row.googleTask?.status === 'completed' && change.progress !== 100) {
      throw new Error('This task is marked complete in Google Tasks.');
    }
    row.progress = change.progress;
  }

  function resolve(number) {
    const task = model.numbered.get(number);
    if (!task) throw new Error('Could not find task #' + number + '. Read the chart for the current task numbers.');
    return task;
  }

  if (change.parentNumber === 0) delete row.parentId;
  else if (change.parentNumber != null) {
    const parent = resolve(change.parentNumber);
    if (parent.row.milestone) throw new Error('A milestone cannot be a parent task.');
    if (reaches(parent, row, item => [model.byId.get(item.row.parentId)])) throw new Error('The parent would create a task hierarchy cycle.');
    row.parentId = ensureId(parent.row);
  }

  if (change.predecessorNumbers != null) {
    if (!Array.isArray(change.predecessorNumbers)) throw new Error('Provide a list of predecessor task numbers.');
    row.predecessors = [...new Set(change.predecessorNumbers)].map(number => {
      const task = resolve(number);
      if (reaches(task, row, item => predecessors(item.row).map(id => model.byId.get(id)))) {
        throw new Error('The predecessor would create a dependency cycle.');
      }
      return ensureId(task.row);
    });
  }
  return datesChanged;
}

export function applyGanttChanges(original, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 30) {
    throw new Error('Provide between 1 and 30 Gantt task changes.');
  }
  const data = structuredClone(original);
  numberGanttTasks(data);
  const rescheduled = new Set(), progressEdited = new Set();
  const affected = new Set();
  for (const change of changes) {
    if (!isRecord(change) || !['add', 'update', 'remove'].includes(change.action)) {
      throw new Error('Choose add, update, or remove for each task change.');
    }
    const model = ganttTasks(data.rows, data.lastTaskNumber);
    if (change.action === 'add') {
      if (typeof change.title !== 'string' || !change.title.trim()) throw new Error('Provide a title for the new task.');
      if (data.lastTaskNumber >= Number.MAX_SAFE_INTEGER) throw new Error('The chart has no remaining task numbers.');
      const row = { taskNumber: ++data.lastTaskNumber };
      if (updateTask(row, change, model)) rescheduled.add(row);
      if (change.progress != null) progressEdited.add(row);
      data.rows.push(row);
      affected.add(row.taskNumber);
      continue;
    }
    const task = model.numbered.get(change.taskNumber);
    if (!task) throw new Error('Could not find task #' + change.taskNumber + '. Read the chart for the current task numbers.');
    affected.add(task.number);
    if (change.action === 'remove') removeGanttTask(data.rows, task);
    else {
      const wasMilestone = task.row.milestone;
      if (updateTask(task.row, change, model)) rescheduled.add(task.row);
      if (change.progress != null) progressEdited.add(task.row);
      if (!wasMilestone && task.row.milestone && task.children.length) {
        throw new Error('Move this task’s subtasks before converting it to a milestone.');
      }
    }
  }

  for (const { row, children } of ganttTasks(data.rows, data.lastTaskNumber).ordered) {
    if (rescheduled.has(row) && children.some(child => Number.isFinite(child.start))) {
      throw new Error('Edit the subtasks to change the dates of a summary task.');
    }
    if (progressEdited.has(row) && children.length) {
      throw new Error('Edit the subtasks to change the progress of a summary task.');
    }
  }
  return { data, taskNumbers: [...affected] };
}
