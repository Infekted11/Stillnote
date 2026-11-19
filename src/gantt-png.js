import { ganttTaskColor, ganttTasks, hourMs, predecessors } from '../electron/gantt-model.mjs';
import { ganttCalendar, ganttDependencyPaths, ganttLayout } from './gantt.js';

const font = 'DM Sans, system-ui, sans-serif';
const utcDates = options => new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' });
const month = utcDates({ month: 'short' });
const monthAndYear = utcDates({ month: 'short', year: 'numeric' });
const dayAndYear = utcDates({ month: 'short', day: 'numeric', year: 'numeric' });

function wrapLabel(ctx, label, width) {
  const words = label.split(/\s+/);
  const lines = [words[0]];
  for (const word of words.slice(1)) {
    const last = lines.length - 1;
    const next = lines[last] + ' ' + word;
    if (ctx.measureText(next).width <= width) lines[last] = next;
    else lines.push(word);
  }
  return lines;
}

export function renderGanttPng(rows, title, styles) {
  const tasks = ganttTasks(rows).ordered;
  const bounds = ganttLayout(rows, null, tasks);
  if (!bounds) throw new Error('Add a task with dates before exporting a PNG.');

  const pad = 24;
  const trackWidth = 1280;
  const pixelsPerHour = (trackWidth - pad * 2) / (bounds.last - bounds.first);
  const layout = ganttLayout(rows, { first: bounds.first - pad / pixelsPerHour, pixelsPerHour, width: trackWidth }, tasks);
  const { ticks, groups } = ganttCalendar(layout);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('PNG rendering is unavailable.');
  const { background, header, border, text, muted, link } = Object.fromEntries(
    ['background', 'header', 'border', 'text', 'muted', 'link'].map(name => [name, styles.getPropertyValue('--gantt-' + name).trim()]),
  );

  let numberWidth = 44;
  let labelWidth = 320;
  const lanes = tasks.map(task => ({
    task,
    indent: Math.min(task.depth, 8) * 13,
    font: `${task.children.length ? 650 : 400} 14px ${font}`,
    title: String(task.row.title ?? '').trim() || 'Untitled task',
  }));
  for (const lane of lanes) {
    ctx.font = lane.font;
    numberWidth = Math.max(numberWidth, Math.ceil(ctx.measureText(lane.task.displayNumber).width) + 20);
    labelWidth = Math.max(labelWidth, Math.ceil(ctx.measureText(lane.title).width) + lane.indent + 24);
  }
  const trackLeft = pad + numberWidth + Math.min(labelWidth, 560);
  const right = trackLeft + trackWidth;
  const calendarTop = 68;
  const tierHeight = 28;
  const bodyTop = calendarTop + tierHeight * 2;
  let bottom = bodyTop;
  for (const lane of lanes) {
    ctx.font = lane.font;
    lane.left = pad + numberWidth + lane.indent + 12;
    lane.textWidth = trackLeft - lane.left - 12;
    lane.lines = wrapLabel(ctx, lane.title, lane.textWidth);
    lane.top = bottom;
    bottom += Math.max(38, lane.lines.length * 18 + 14);
    lane.center = (lane.top + bottom) / 2;
  }

  const width = right + pad;
  const height = bottom + pad;
  // Keep the entire chart in one image within Chromium's canvas memory and dimension limits.
  const scale = Math.min(3, 16384 / Math.max(width, height), Math.sqrt(40_000_000 / (width * height)));
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.textBaseline = 'middle';

  function rect(color, left, top, width, height) {
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, height);
  }
  function write(label, x, y, color, maxWidth) {
    ctx.fillStyle = color;
    ctx.fillText(label, x, y, maxWidth);
  }
  const x = hour => trackLeft + (hour - layout.first) * pixelsPerHour;

  rect(background, 0, 0, width, height);
  rect(header, pad, calendarTop, right - pad, bodyTop - calendarTop);
  ctx.font = `650 26px ${font}`;
  write(title, pad, 38, text, width - pad * 2);
  ctx.font = `650 14px ${font}`;
  write('Task', pad + 12, calendarTop + tierHeight, text, trackLeft - pad - 24);

  const hourly = layout.step < 24;
  const monthly = layout.step >= 7 * 24;
  const groupDate = hourly ? dayAndYear : monthAndYear;
  ctx.font = `500 12px ${font}`;
  for (const [cells, top] of [[groups, calendarTop], [ticks, calendarTop + tierHeight]]) {
    const isGroup = cells === groups;
    for (const cell of cells) {
      const left = Math.max(trackLeft, x(cell.start));
      const end = Math.min(right, x(cell.end));
      if (end - left < 1) continue;
      const date = cell.start * hourMs;
      let label = cell.label;
      if (isGroup && !monthly) label = groupDate.format(date);
      if (!isGroup && monthly) label = month.format(date);
      if (!isGroup && hourly) label += ':00';
      if (cell.weekend) rect(header, left, bodyTop, end - left, bottom - bodyTop);
      rect(border, end - 1, top, 1, (isGroup ? tierHeight : bottom - top));
      if (ctx.measureText(label).width + 10 > end - left) continue;
      ctx.textAlign = isGroup ? 'left' : 'center';
      write(label, isGroup ? left + 5 : (left + end) / 2, top + tierHeight / 2, muted, end - left - 10);
    }
  }
  ctx.textAlign = 'left';
  rect(border, trackLeft, calendarTop + tierHeight, trackWidth, 1);
  for (const lane of lanes) {
    const { task, top, left, textWidth, lines, center } = lane;
    if (task.children.length) rect(header, pad, top, trackLeft - pad, (center - top) * 2);
    rect(border, pad, top, right - pad, 1);
    ctx.font = lane.font;
    write(task.displayNumber, pad + 10, center, muted, numberWidth - 20);
    lines.forEach((line, index) => write(line, left, center + (index - (lines.length - 1) / 2) * 18, text, textWidth));
    const color = ganttTaskColor(task);
    for (const range of task.ranges) {
      const start = x(range.start);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#191e2555';
      ctx.fillStyle = color;
      if (task.row.milestone) {
        ctx.save();
        ctx.translate(start, center);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-6, -6, 12, 12);
        ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
      } else {
        const barWidth = Math.max(2, x(range.end) - start);
        const bar = new Path2D();
        bar.roundRect(start, center - 11, barWidth, 22, Math.min(5, barWidth / 2));
        ctx.fill(bar);
        ctx.save();
        ctx.clip(bar);
        rect('#131a2652', start, center - 11, barWidth * task.progress / 100, 22);
        ctx.restore();
        ctx.stroke(bar);
      }
    }
  }
  rect(border, pad + numberWidth, bodyTop, 1, bottom - bodyTop);
  rect(border, trackLeft - 1, calendarTop, 2, bottom - calendarTop);
  ctx.strokeStyle = border;
  ctx.strokeRect(pad + 0.5, calendarTop + 0.5, right - pad - 1, bottom - calendarTop - 1);

  const byId = new Map(lanes.filter(({ task }) => task.row.id).map(lane => [lane.task.row.id, lane]));
  ctx.lineWidth = 1.2;
  ctx.fillStyle = ctx.strokeStyle = link;
  for (const target of lanes) {
    if (!Number.isFinite(target.task.start)) continue;
    for (const id of predecessors(target.task.row)) {
      const source = byId.get(id);
      if (!source || source === target || !Number.isFinite(source.task.end)) continue;
      const from = x(source.task.end) + (source.task.row.milestone ? 8 : 0);
      const to = x(target.task.start) - (target.task.row.milestone ? 8 : 0);
      const { line, arrow } = ganttDependencyPaths(from, to, source.center, target.center);
      ctx.stroke(new Path2D(line));
      ctx.fill(new Path2D(arrow));
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob(png => {
    canvas.width = canvas.height = 0;
    if (png) resolve(png);
    else reject(new Error('Could not create the PNG image.'));
  }, 'image/png'));
}
