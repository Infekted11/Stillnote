const path = require('node:path');
const { applyGanttChanges } = require('./gantt-ai.mjs');

const formats = ['spreadsheet', 'gantt', 'canvas', 'graph', 'geometry', 'calculator3d'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function structuredContent(format, file, initialData) {
  const title = path.basename(file).replace(/\.md$/i, '');
  if (!/\.md$/i.test(file) || !title.trim() || /[<>:"|?*\x00-\x1f]/.test(title)) {
    throw new Error('Choose a valid chart or document title with a .md vault path.');
  }
  if (!formats.includes(format)) throw new Error('Choose a supported Stillnote document format.');
  if (initialData != null && (typeof initialData !== 'string' || initialData.length > 150000)) {
    throw new Error('Provide initial data as JSON text up to 150,000 characters.');
  }
  let input = {};
  if (initialData != null) {
    try { input = JSON.parse(initialData); } catch { throw new Error('Provide valid JSON for the initial document data.'); }
  }
  if (!record(input)) throw new Error('Initial document data must be a JSON object.');

  const data = { version: 1 };
  let allowed;
  if (format === 'gantt') {
    allowed = ['tasks'];
    const tasks = input.tasks ?? [];
    if (!Array.isArray(tasks) || !tasks.every(record)) throw new Error('Provide Gantt tasks as an array of objects.');
    data.rows = [];
    if (tasks.length) Object.assign(data, applyGanttChanges(data, tasks.map(task => ({ ...task, action: 'add' }))).data);
  } else if (format === 'spreadsheet') {
    allowed = ['rows', 'columns', 'cells'];
    const { rows = 20, columns = 8, cells = {} } = input;
    if (!Number.isSafeInteger(rows) || rows < 1 || !Number.isSafeInteger(columns) || columns < 1 || rows * columns > 100000 || !record(cells)) {
      throw new Error('Provide positive spreadsheet dimensions up to 100,000 cells and a cell-address object.');
    }
    for (const [address, value] of Object.entries(cells)) {
      const cell = /^([A-Z]+)([1-9]\d*)$/.exec(address);
      const column = cell && Array.from(cell[1]).reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
      if (!cell || column > columns || Number(cell[2]) > rows || (typeof value !== 'string' && !Number.isFinite(value))) {
        throw new Error('Place text, numbers, or formula strings at valid addresses inside the spreadsheet.');
      }
    }
    Object.assign(data, { rows, columns, cells: Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, String(value)])) });
  } else if (format === 'canvas') {
    allowed = ['elements'];
    const elements = input.elements ?? [];
    if (!Array.isArray(elements)) throw new Error('Provide canvas elements as an array.');
    Object.assign(data, { width: 1200, height: 760, elements: elements.map(element => {
      if (!record(element) || !['text', 'rect', 'ellipse'].includes(element.type)
          || ![element.x, element.y, element.w, element.h].every(Number.isFinite)
          || element.w <= 0 || element.h <= 0 || (element.type === 'text' && typeof element.text !== 'string')) {
        throw new Error('Canvas elements need a supported type, numeric x and y, positive w and h, and text for text boxes.');
      }
      const { type, x, y, w, h, text } = element;
      return type === 'text' ? { type, x, y, w, h, text } : { type, x, y, w, h };
    }) });
  } else {
    allowed = format === 'graph' ? ['expressions'] : [];
    data.state = null;
    if (input.expressions !== undefined && format === 'graph') {
      if (!Array.isArray(input.expressions) || !input.expressions.every(value => typeof value === 'string' && value.trim())) {
        throw new Error('Provide graph expressions as an array of nonempty LaTeX strings.');
      }
      data.expressions = input.expressions;
    }
  }
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Use the initial data fields for the selected document format.');
  const fence = '\x60\x60\x60';
  return [title, '<!-- stillnote:type=' + format + ' -->', '', fence + 'stillnote-' + format, JSON.stringify(data, null, 2), fence, ''].join('\n');
}

module.exports = { formats, structuredContent };
