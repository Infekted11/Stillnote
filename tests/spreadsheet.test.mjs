import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
// Load as ESM regardless of the app package's CommonJS default.
const moduleSource = await readFile(new URL('../src/spreadsheet.js', import.meta.url), 'utf8');
const { reorderSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(main.slice(main.indexOf('function spreadsheetCellValue('), main.indexOf('function columnLabel(')), context);
const value = (data, cell) => context.spreadsheetCellValue(data, cell);

test('moving rows preserves dependencies, formulas in moved cells, and text', () => {
  const data = { rows: 4, columns: 3, cells: { A1: '5', A2: '9', B1: '=A1+A2', C4: '=B1*2', B3: 'A1 <[notes/A1.md]>' } };
  const before = value(data, 'C4');
  assert.equal(reorderSpreadsheet(data, 'row', 0, 2), true);
  assert.equal(data.cells.A3, '5');
  assert.equal(data.cells.B3, '=A3+A1');
  assert.equal(data.cells.C4, '=B3*2');
  assert.equal(data.cells.B2, 'A1 <[notes/A1.md]>');
  assert.equal(value(data, 'C4'), before);
  reorderSpreadsheet(data, 'row', 2, 0);
  assert.equal(data.cells.B1, '=A1+A2');
});
test('column moves update every reference once, including multi-letter columns', () => {
  const data = { rows: 3, columns: 28, cells: { A1: '3', B1: '7', AA1: '2', AB3: '=A1+B1+AA1+A1' } };
  const before = value(data, 'AB3');
  reorderSpreadsheet(data, 'column', 0, 26);
  assert.equal(data.cells.AA1, '3');
  assert.equal(data.cells.AB3, '=AA1+A1+Z1+AA1');
  assert.equal(value(data, 'AB3'), before);
});
test('upward and leftward moves preserve computed results', () => {
  const data = { rows: 4, columns: 4, cells: { D4: '12', B2: '=D4/3', A1: '=B2+1' } };
  reorderSpreadsheet(data, 'row', 3, 0);
  reorderSpreadsheet(data, 'column', 3, 0);
  assert.equal(data.cells.A1, '12');
  assert.equal(value(data, 'B2'), '5');
});
test('invalid moves and no-ops leave data unchanged', () => {
  const data = { rows: 2, columns: 2, cells: { A1: '=B2' } }, before = JSON.stringify(data);
  for (const [axis, from, to] of [['row', 0, 0], ['row', -1, 1], ['column', 0, 2], ['other', 0, 1]]) {
    assert.equal(reorderSpreadsheet(data, axis, from, to), false);
    assert.equal(JSON.stringify(data), before);
  }
});

test('custom column names follow columns while row moves leave names unchanged', () => {
  const data = { rows: 2, columns: 3, columnNames: ['Cost', '', 'Total'], cells: { A1: '4', C1: '=A1*2' } };
  reorderSpreadsheet(data, 'column', 0, 2);
  assert.deepEqual(data.columnNames, ['', 'Total', 'Cost']);
  assert.equal(data.cells.B1, '=C1*2');
  reorderSpreadsheet(data, 'row', 0, 1);
  assert.deepEqual(data.columnNames, ['', 'Total', 'Cost']);
  assert.equal(value(data, 'B2'), '8');
  assert.deepEqual(JSON.parse(JSON.stringify(data)).columnNames, data.columnNames);
});
