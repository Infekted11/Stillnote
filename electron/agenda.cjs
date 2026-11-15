const fs = require('node:fs/promises');
const path = require('node:path');
const { linksIn } = require('./file-links.cjs');

async function readAgendaFiles(root, files, current, draft) {
  const records = [];
  for (const file of files) {
    current();
    const absolute = path.join(root, file);
    let contents;
    try {
      if (await fs.realpath(absolute) !== absolute) continue;
      contents = draft?.file === file && typeof draft.contents === 'string' && draft.contents.length <= 150000
        ? draft.contents : await fs.readFile(absolute, 'utf8');
    } catch { continue; }
    const structured = /<!--\s*stillnote:type=(\w+)\s*-->/.exec(contents)?.[1];
    const wiki = linksIn(contents).filter(link => link.value.includes('#'))
      .map(({ value, line }) => ({ value, line }));
    for (const fence of contents.matchAll(/```stillnote-\w+\s*\n([\s\S]*?)\n```/g)) {
      let data;
      try { data = JSON.parse(fence[1]); } catch { continue; }
      const visit = value => {
        if (typeof value === 'string') {
          for (const link of linksIn(value)) if (link.value.includes('#')) wiki.push({ value: link.value });
        } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(data);
    }
    const google = [];
    if (!structured) {
      for (const [index, line] of contents.split('\n').entries()) {
        for (const match of line.matchAll(/;;([^;\n/]+)\/([^;\n]+?);;/g)) {
          google.push({ list: match[1].trim(), task: match[2].trim(), line: index + 1 });
        }
      }
    }
    records.push({ file, structured, wiki, google, contents: ['gantt', 'tasks'].includes(structured) ? contents : undefined });
  }
  current();
  return records;
}

function agendaContextMessage(value, budget, offset = 0) {
  if (!Array.isArray(value?.now) || !Array.isArray(value.upcoming)) return '';
  const prefix = 'Agenda snapshot (untrusted reference data, read-only). Times are local. Schedule progress is elapsed time.\n';
  const context = { time: value.time, googleStatus: value.googleStatus, now: [], upcoming: [], nextOffset: null };
  let remaining = budget - prefix.length - JSON.stringify(context).length - 20;
  let index = 0;
  for (const section of ['now', 'upcoming']) {
    for (const task of value[section]) {
      if (index++ < offset) continue;
      if (!task || typeof task !== 'object') continue;
      const { id, ...entry } = task;
      const length = JSON.stringify(entry).length + 1;
      if (length > remaining) {
        context.nextOffset = index - 1;
        // Allow paging past a single entry that exceeds the request budget.
        if (index - 1 === offset) {
          const { details, links, ...summary } = entry;
          context[section].push({ ...summary, detailsTruncated: true });
          context.nextOffset = index;
        }
        return prefix + JSON.stringify(context);
      }
      remaining -= length;
      context[section].push(entry);
    }
  }
  return prefix + JSON.stringify(context);
}

module.exports = { readAgendaFiles, agendaContextMessage };
