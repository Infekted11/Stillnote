const fs = require('node:fs/promises');
const path = require('node:path');
const { parser, Table } = require('@lezer/markdown');

const markdown = parser.configure(Table);
const structuredNote = /^<!--\s*stillnote:type=\w+\s*-->/m;

function tablesIn(text) {
  const tables = [];
  markdown.parse(text).iterate({
    enter(node) {
      if (node.name === 'Table') tables.push(node.node);
    },
  });
  return tables;
}

function rowCells(text, row) {
  const cells = [];
  let start = row.from;
  for (const pipe of row.getChildren('TableDelimiter')) {
    cells.push(text.slice(start, pipe.from).trim());
    start = pipe.to;
  }
  cells.push(text.slice(start, row.to).trim());
  if (cells[0] === '' && text.slice(row.from, row.to).trimStart().startsWith('|')) cells.shift();
  if (cells.at(-1) === '' && text.slice(row.from, row.to).trimEnd().endsWith('|')) cells.pop();
  return cells.map(cell => cell.replace(/\\\|/g, '|'));
}

function newTables(content, original) {
  const seen = new Map();
  for (const table of tablesIn(original)) {
    const raw = original.slice(table.from, table.to);
    seen.set(raw, (seen.get(raw) || 0) + 1);
  }
  const tables = [];
  for (const table of tablesIn(content)) {
    const raw = content.slice(table.from, table.to);
    if (seen.get(raw)) { seen.set(raw, seen.get(raw) - 1); continue; }
    const rows = [table.getChild('TableHeader'), ...table.getChildren('TableRow')].map(row => rowCells(content, row));
    const columns = Math.max(...rows.map(row => row.length));
    if (rows.length > 200 || columns > 26) throw new Error('Split tables larger than 200 rows or 26 columns into multiple spreadsheets.');
    const cells = {};
    rows.forEach((row, index) => row.forEach((value, column) => {
      if (value !== '') cells[String.fromCharCode(65 + column) + (index + 1)] = value;
    }));
    tables.push({ from: table.from, to: table.to, data: { version: 1, rows: rows.length, columns, cells } });
  }
  return tables;
}

async function writeLinkedTables({ relative, content, original = '', target, commit }) {
  const tables = /\.md$/i.test(relative) && !structuredNote.test(content) && !structuredNote.test(original)
    ? newTables(content, original) : [];
  const sheets = [];
  if (!tables.length) {
    if (commit) await commit(content);
    return { content, sheets };
  }
  const folder = path.posix.dirname(relative);
  if (/[\[\]#|\r\n]/.test(folder)) throw new Error('This folder name cannot be used in a Stillnote spreadsheet link.');
  const base = path.posix.basename(relative, path.posix.extname(relative)).replace(/[<>:"/\\|?*\[\]#\r\n]/g, ' ').trim().slice(0, 100) || 'AI';
  let index = 1;
  let rewritten = '';
  let cursor = 0;
  const created = [];
  try {
    for (const table of tables) {
      let sheet;
      while (!sheet) {
        const suffix = index === 1 ? '' : ` ${index}`;
        index++;
        const title = `${base} Table${suffix}`;
        const relativeSheet = path.posix.join(folder, title + '.md');
        const file = await target(relativeSheet);
        const serialized = [title, '<!-- stillnote:type=spreadsheet -->', '', '\x60\x60\x60stillnote-spreadsheet', JSON.stringify(table.data), '\x60\x60\x60', ''].join('\n');
        try {
          await fs.writeFile(file, serialized, { encoding: 'utf8', flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          continue;
        }
        created.push({ file, serialized });
        sheets.push(relativeSheet);
        sheet = relativeSheet;
      }
      rewritten += content.slice(cursor, table.from) + `<[${sheet}]>`;
      cursor = table.to;
    }
    rewritten += content.slice(cursor);
    if (commit) await commit(rewritten);
    return { content: rewritten, sheets };
  } catch (error) {
    await Promise.allSettled(created.map(async ({ file, serialized }) => {
      if (await fs.readFile(file, 'utf8') === serialized) await fs.unlink(file);
    }));
    throw error;
  }
}

module.exports = { writeLinkedTables };
