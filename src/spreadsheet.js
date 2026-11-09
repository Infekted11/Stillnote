// Reorder cells and references with the same permutation, including formulas
// outside the moved row/column. Plain text and links are left unchanged.
export function reorderSpreadsheet(data, axis, from, to) {
  const count = axis === 'row' ? data.rows : axis === 'column' ? data.columns : 0;
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < count) || from === to) return false;
  const order = Array.from({ length: count }, (_, index) => index);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const positions = new Map(order.map((original, index) => [original, index]));
  const address = (letters, number) => {
    let column = 0;
    for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
    let row = Number(number) - 1;
    column--;
    if (axis === 'row') row = positions.get(row) ?? row;
    else column = positions.get(column) ?? column;
    let label = '';
    for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
    return `${label}${row + 1}`;
  };
  const cells = {};
  for (const [key, value] of Object.entries(data.cells)) {
    const match = /^([A-Z]+)([1-9]\d*)$/i.exec(key);
    const newKey = match ? address(match[1], match[2]) : key;
    cells[newKey] = typeof value === 'string' && value.startsWith('=')
      ? value.replace(/\b([A-Z]+)([1-9]\d*)\b/gi, (_, letters, number) => address(letters, number)) : value;
  }
  if (axis === 'column' && Array.isArray(data.columnNames)) {
    data.columnNames = order.map(index => data.columnNames[index] || '');
  }
  data.cells = cells;
  return true;
}
