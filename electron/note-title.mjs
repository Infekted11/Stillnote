export function noteTitleLine(doc) {
  if (!/^\uFEFF?---[ \t]*$/.test(doc.line(1).text)) return 1;
  for (let number = 2; number <= doc.lines; number++) {
    if (!/^---[ \t]*$/.test(doc.line(number).text)) continue;
    number++;
    while (number <= doc.lines && !doc.line(number).text.trim()) number++;
    return number;
  }
  return 1;
}

export function noteTitleName(line) {
  return line.trim().replace(/^#{1,6}[ \t]+/, '').trim().replace(/\.md$/i, '').trim();
}

export function syncNoteTitle(content, title, previousTitle = title) {
  const lines = content.split(/(\r\n|\n)/);
  const ending = content.includes('\r\n') ? '\r\n' : '\n';
  const number = noteTitleLine({ lines: (lines.length + 1) / 2, line: n => ({ text: lines[(n - 1) * 2] }) });
  const index = (number - 1) * 2;
  const line = lines[index] ?? '';
  const bom = index === 0 && line.startsWith('\uFEFF') ? '\uFEFF' : '';
  const parsedTitle = noteTitleName(line);
  if (line.trim() === title || parsedTitle === title) return content;
  if (index >= lines.length) {
    const gap = content.endsWith(ending + ending) ? '' : content.endsWith(ending) ? ending : ending + ending;
    return content + gap + title + ending;
  }
  if (!line.trim() || line.trim() === previousTitle || parsedTitle === previousTitle) {
    lines[index] = bom + title;
    if (lines.length === 1 && !line.trim()) return lines[0] + ending + ending;
  } else {
    // Keep a legacy note's existing first paragraph or heading as body content.
    lines[index] = bom + title + ending + ending + line.slice(bom.length);
  }
  return lines.join('');
}
