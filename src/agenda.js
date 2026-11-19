import { ganttTasks, hourValue, nowHour } from './gantt.js';
import { ganttTaskReference, parseVaultLink } from './vault-links.js';

const normalize = value => String(value ?? '').trim().toLowerCase();
const pathKey = value => normalize(value).replace(/\\/g, '/').replace(/^\.\//, '');
const googleKey = (list, task) => JSON.stringify([list, task]);
const titleKey = (list, task) => googleKey(normalize(list), normalize(task));
const wikis = /<\[([^\]\r\n]+)\]>|\[\[([^\]\r\n]+)\]\]/g;
const firstLine = value => String(value ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
const decodeReference = value => { try { return decodeURIComponent(value); } catch { return value; } };
const fileLink = (file, fragment = '') => ({ file, fragment });
const append = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

function validDue(value) {
  const date = String(value ?? '').slice(0, 10);
  const timestamp = Date.parse(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === date ? date : '';
}

function externalLink(value, label) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
      return { url: url.href, label: label || url.hostname };
    }
  } catch {}
  return null;
}

export function collectAgenda({ files, google }, decodeStructured) {
  const catalog = new Map(files.map(record => [pathKey(record.file), record.file]));
  const resolve = (target, origin) => {
    const { path, fragment } = parseVaultLink(target);
    if (!path) return fragment && origin ? fileLink(origin, fragment) : null;
    const key = pathKey(path);
    const file = catalog.get(key) || (!/\.[^/]+$/.test(key) && catalog.get(key + '.md'));
    return file ? fileLink(file, fragment) : externalLink(path);
  };
  const fromNotes = (notes, origin) => {
    const links = Array.from(String(notes ?? '').matchAll(wikis), match => resolve(match[1] ?? match[2], origin));
    for (const [value] of String(notes ?? '').matchAll(/(?:stillnote:\/\/open\?|https?:\/\/)[^\s<>"\])]+/g)) {
      if (value.startsWith('stillnote:')) {
        const url = new URL(value);
        const file = catalog.get(pathKey(url.searchParams.get('note')));
        const line = Number(url.searchParams.get('line'));
        if (file) links.push(fileLink(file, Number.isInteger(line) && line > 0 ? `L${line}` : ''));
      } else links.push(externalLink(value));
    }
    return links.filter(Boolean);
  };
  const detailsLine = notes => firstLine(String(notes ?? '').replace(/^\s*Stillnote note: stillnote:\/\/open\?[^\r\n]+/gm, ''));
  const charts = [], sheets = new Map(), wikiBacklinks = new Map(), googleBacklinks = new Map();
  for (const record of files) {
    const { file, structured, wiki, google: references, contents } = record;
    for (const { value, line } of wiki) {
      const link = resolve(value, file);
      const ref = ganttTaskReference(link?.fragment);
      if (link?.file && ref) {
        const id = ref.instanceNumber === null ? [link.file, ref.taskNumber] : [link.file, ref.taskNumber, ref.instanceNumber];
        append(wikiBacklinks, JSON.stringify(id), fileLink(file, structured ? '' : `L${line}`));
      }
    }
    for (const { list, task, line } of references) {
      append(googleBacklinks, titleKey(decodeReference(list), decodeReference(task)), fileLink(file, `L${line}`));
    }
    if (!contents) continue;
    const parsed = decodeStructured(contents);
    const source = file.split('/').at(-1).replace(/\.md$/i, '');
    if (parsed?.type === 'tasks' && parsed.data?.listId) {
      append(sheets, parsed.data.listId, { source, file, tasks: parsed.data.tasks });
    } else if (parsed?.type === 'gantt' && Array.isArray(parsed.data?.rows)) {
      const { rows, lastTaskNumber } = parsed.data;
      charts.push({ file, source, tasks: ganttTasks(rows.filter(row => row && typeof row === 'object'), lastTaskNumber).ordered });
    }
  }

  const googleTasks = new Map(), listNames = new Map(), taskNames = new Map(), chartBacklinks = new Map();
  const lists = new Map(google.lists.map(list => [list.id, list]));
  for (const [listId, [sheet]] of sheets) {
    if (!lists.has(listId) && google.status !== 'synced' && Array.isArray(sheet.tasks)) {
      lists.set(listId, { id: listId, title: sheet.source, tasks: sheet.tasks, cached: true });
    }
  }
  for (const list of lists.values()) {
    const source = list.title || 'Google Tasks';
    append(listNames, normalize(source), list.id);
    for (const task of list.tasks) {
      if (!task?.id || task.deleted) continue;
      const title = task.title || 'Untitled task';
      const key = googleKey(list.id, task.id);
      googleTasks.set(key, { task, source, title, listId: list.id, cached: Boolean(list.cached) });
      append(taskNames, titleKey(source, title), key);
    }
  }

  const entries = [];
  for (const chart of charts) {
    for (const { row, number, ranges } of chart.tasks) {
      const taskOrigin = fileLink(chart.file, `task-${number}`);
      const linked = row.googleTask;
      const key = linked && googleKey(linked.listId, linked.taskId);
      if (key) append(chartBacklinks, key, taskOrigin);
      const related = googleTasks.get(key);
      const milestone = Boolean(row.milestone);
      const details = row.notes ?? row.description ?? related?.task.notes;
      const taskId = JSON.stringify([chart.file, number]);
      const links = [
        ...(wikiBacklinks.get(taskId) || []),
        ...fromNotes(details, chart.file),
        ...(sheets.get(linked?.listId) || []).map(sheet => fileLink(sheet.file)),
        ...fromNotes(related?.task.notes),
        externalLink(related?.task.webViewLink, 'Google Tasks'),
      ].filter(Boolean);
      for (const { start, end, instance, number: occurrence } of ranges) {
        const allDay = start % 24 === 0 && end % 24 === 0 && (!instance
          || (instance.start?.length === 10 && (milestone || instance.end?.length === 10)));
        const numbered = occurrence !== null && (ranges.length > 1 || occurrence > 1);
        const instanceId = occurrence == null ? null : JSON.stringify([chart.file, number, occurrence]);
        const name = row.title || 'Untitled task';
        entries.push({
          id: numbered ? instanceId : taskId, kind: 'gantt',
          title: name, ...(numbered ? { instanceNumber: occurrence } : {}),
          source: chart.source, origin: numbered ? fileLink(chart.file, `task-${number}-instance-${occurrence}`) : taskOrigin,
          start, end, allDay: Boolean(allDay), milestone, details: detailsLine(details),
          links: [...links, ...(wikiBacklinks.get(instanceId) || [])],
        });
      }
    }
  }

  for (const [key, { task, source, title, listId, cached }] of googleTasks) {
    if (task.status === 'completed' || task.hidden) continue;
    const sheetsForList = sheets.get(listId) || [];
    const web = externalLink(task.webViewLink, 'Google Tasks');
    const matchingTitle = titleKey(source, title);
    const unique = listNames.get(normalize(source)).length === 1 && taskNames.get(matchingTitle).length === 1;
    entries.push({
      id: key, kind: 'google', title, source, listId, taskId: task.id, due: validDue(task.due), cached,
      origin: sheetsForList.length ? fileLink(sheetsForList[0].file) : web,
      details: detailsLine(task.notes),
      links: [
        ...sheetsForList.slice(1).map(sheet => fileLink(sheet.file)), web,
        ...(unique ? googleBacklinks.get(matchingTitle) || [] : []),
        ...(chartBacklinks.get(key) || []),
        ...fromNotes(task.notes),
        ...(task.links || []).map(link => externalLink(link.link, link.description)),
        externalLink(task.assignmentInfo?.linkToTask),
      ].filter(Boolean),
    });
  }
  for (const entry of entries) {
    const links = new Map();
    for (const link of entry.links) {
      const key = link.url || JSON.stringify([link.file, link.fragment]);
      links.set(key, link);
    }
    entry.links = [...links.values()];
  }
  return { entries, googleStatus: google.status };
}

export function agendaSnapshot({ entries, googleStatus }, date = new Date()) {
  const hour = nowHour(date), time = hourValue(Math.floor(hour * 60) / 60), today = time.slice(0, 10);
  const now = [], upcoming = [];
  for (const { start, end, ...entry } of entries) {
    if (entry.kind === 'google') {
      (entry.due > today ? upcoming : now).push({ ...entry, overdue: Boolean(entry.due && entry.due < today) });
      continue;
    }
    // Keep today's elapsed milestones in view since they have no duration.
    if (entry.milestone ? hourValue(start).slice(0, 10) < today : end <= hour) continue;
    const active = start <= hour;
    const progress = entry.milestone ? Number(active) * 100 : Math.floor(Math.max(0, Math.min(1, (hour - start) / (end - start))) * 100);
    (active ? now : upcoming).push({
      ...entry, start: hourValue(start), end: hourValue(entry.allDay && !entry.milestone ? end - 24 : end), progress,
    });
  }
  const dateOrder = task => task.start || task.due || '\uffff';
  const sort = (a, b) => dateOrder(a).localeCompare(dateOrder(b)) || a.title.localeCompare(b.title);
  return { time, googleStatus, now: now.sort(sort), upcoming: upcoming.sort(sort) };
}

export function relevantAgenda({ time, now, upcoming }, { file, prompt, document = '', paths = [] }) {
  const linkedPaths = new Set(paths.map(pathKey));
  const wholeCharts = new Set(Array.from(document.matchAll(wikis), match => parseVaultLink(match[1] ?? match[2]))
    .filter(link => link.path && !link.fragment).map(link => pathKey(link.path)));
  const query = ' ' + normalize(prompt).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const matchesName = value => {
    const name = normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return name.length >= 3 && query.includes(` ${name} `);
  };
  const fileMatch = link => link?.file && pathKey(link.file) === pathKey(file);
  function filter(items) {
    return items.filter(item => {
      const linked = fileMatch(item.origin) || item.links.some(fileMatch);
      const origin = item.origin?.file && pathKey(item.origin.file);
      const directlyLinked = origin && linkedPaths.has(origin) && (item.kind === 'google'
        || wholeCharts.has(origin) || wholeCharts.has(origin.replace(/\.md$/i, '')));
      return linked || directlyLinked || matchesName(item.title) || matchesName(item.source);
    });
  }
  return { time, now: filter(now), upcoming: filter(upcoming) };
}
