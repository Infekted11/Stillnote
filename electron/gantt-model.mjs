const dayMs = 86_400_000;

export function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / dayMs : NaN;
}

export const hourMs = dayMs / 24;
const hues = { Rose: 345, Peach: 24, Butter: 48, Mint: 152, Sky: 204, Lavender: 264 };
const saturations = { Soft: 34, Pastel: 56, Rich: 76 };
const legacyColors = { Lilac: 'Lavender Soft', Coral: 'Peach Rich', Sage: 'Mint Soft', Aqua: 'Mint Rich',
  Periwinkle: 'Sky Soft', Sand: 'Butter Soft', Green: 'Mint Rich', Blue: 'Sky Rich', Magenta: 'Rose Rich' };
const colorValues = Object.fromEntries(Object.entries(saturations).flatMap(([tone, saturation]) =>
  Object.entries(hues).map(([hue, angle]) => [tone === 'Pastel' ? hue : hue + ' ' + tone, [angle, saturation]])));
const colorAt = (name, depth = 0) => {
  const [hue, saturation] = colorValues[name];
  return `hsl(${hue} ${saturation}% ${97 - 17 * 0.65 ** depth}%)`;
};
export const colors = Object.fromEntries(Object.keys(colorValues).map(name => [name, colorAt(name)]));
export function ganttColorName(row, index) {
  const name = Object.hasOwn(legacyColors, row.color) ? legacyColors[row.color] : row.color;
  return Object.hasOwn(colors, name) ? name : Object.keys(hues)[index % 6];
}

export function ganttTaskColor(task) {
  let root = task;
  while (root.parent) root = root.parent;
  return colorAt(ganttColorName(root.row, root.index), task.depth);
}

export function hour(value, end = false) {
  if (Number.isFinite(day(value))) return day(value) * 24 + (end ? 24 : 0);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return NaN;
  const timestamp = Date.parse(`${value}Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp / hourMs : NaN;
}

export const hourValue = (value) => new Date(Math.round(value * hourMs)).toISOString().slice(0, 16);

const progressValue = row => row.googleTask?.status === 'completed' ? 100 : Math.min(100, Math.max(0, Number(row.progress) || 0));

export function ganttInstances(row) {
  return [{ number: primaryGanttInstanceNumber(row), instance: row },
    ...(Array.isArray(row.instances) ? row.instances : [])
      .filter(instance => Number.isSafeInteger(instance?.number) && instance.number > 1)
      .map(instance => ({ number: instance.number, instance }))];
}

export function primaryGanttInstanceNumber(row) {
  return Number.isSafeInteger(row.instanceNumber) && row.instanceNumber > 1 ? row.instanceNumber : 1;
}

export function ganttInstanceRange(instance, milestone, number = 1) {
  const start = hour(instance.start);
  const end = milestone ? start : hour(instance.end, true);
  return { start: end > start || (milestone && Number.isFinite(start)) ? start : NaN, end, instance, number };
}

export function lastGanttInstanceNumber(row) {
  return ganttInstances(row).reduce((last, entry) => Math.max(last, entry.number),
    Number.isSafeInteger(row.lastInstanceNumber) ? row.lastInstanceNumber : 1);
}

export function removeGanttInstance(row, number) {
  const instances = ganttInstances(row);
  if (instances.length < 2 || !instances.some(entry => entry.number === number)) return false;
  row.lastInstanceNumber = lastGanttInstanceNumber(row);
  const remaining = instances.filter(entry => entry.number !== number);
  const primary = remaining.shift();
  if (primary.instance !== row) {
    row.instanceNumber = primary.number;
    row.start = primary.instance.start;
    row.end = primary.instance.end;
  }
  row.instances = remaining.map(entry => entry.instance);
  return true;
}

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
  function visit(task, depth, displayNumber) {
    task.depth = depth;
    task.displayNumber = displayNumber;
    ordered.push(task);
    task.children.forEach((child, index) => visit(child, depth + 1, displayNumber + '.' + (index + 1)));
    const scheduled = task.children.filter(child => Number.isFinite(child.start));
    if (scheduled.length) {
      task.start = Math.min(...scheduled.map(child => child.start));
      task.end = Math.max(...scheduled.map(child => child.end));
      const total = scheduled.reduce((sum, child) => sum + child.weight, 0);
      task.progress = total ? scheduled.reduce((sum, child) => sum + child.weight * child.progress, 0) / total : 0;
      task.weight = total;
      task.ranges = [{ start: task.start, end: task.end, number: null }];
    } else {
      task.ranges = ganttInstances(task.row).map(({ instance, number }) =>
        ganttInstanceRange(instance, task.row.milestone, number)).filter(range => Number.isFinite(range.start));
      task.start = task.ranges.length ? Math.min(...task.ranges.map(range => range.start)) : NaN;
      task.end = task.ranges.length ? Math.max(...task.ranges.map(range => range.end)) : NaN;
      task.progress = progressValue(task.row);
      task.weight = task.ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    }
  }
  roots.forEach((root, index) => visit(root, 0, String(index + 1)));
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

export function predecessors(row) {
  return Array.isArray(row.predecessors) ? row.predecessors : [];
}

export function numberGanttTasks(data, model = ganttTasks(data.rows, data.lastTaskNumber)) {
  for (const task of model.ordered) task.row.taskNumber = task.number;
  data.lastTaskNumber = model.lastTaskNumber;
}

export function removeGanttTask(rows, task) {
  const { row, parent, children } = task;
  for (const child of children) {
    if (parent) child.row.parentId = parent.row.id;
    else delete child.row.parentId;
  }
  if (row.id) {
    for (const item of rows) {
      if (predecessors(item).includes(row.id)) item.predecessors = item.predecessors.filter(id => id !== row.id);
    }
  }
  rows.splice(rows.indexOf(row), 1);
}
