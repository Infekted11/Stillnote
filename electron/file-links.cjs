const linkPattern = /<\[([^\]\r\n]+)\]>|\[\[([^\]\r\n]+)\]\]/g;
function linksIn(text) {
  return [...text.matchAll(linkPattern)].map((match) => {
    const value = match[1] ?? match[2];
    const rawTarget = value.split('|')[0].split('#')[0].trim();
    const target = rawTarget.replace(/^!!!/, '').trim();
    return { match, value, target, line: text.slice(0, match.index).split('\n').length };
  });
}
function matchesPath(target, file) {
  const clean = target.trim().replace(/^!!!/, '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return clean === file.toLowerCase() || (!/\.[^/]+$/.test(clean) && `${clean}.md` === file.toLowerCase());
}
function rewritePlainLinks(text, moves) {
  const references = linksIn(text);
  for (const { match, value, target } of references.reverse()) {
    const move = moves.find(([oldPath]) => matchesPath(target, oldPath));
    if (!move) continue;
    const suffix = value.slice(value.split('|')[0].split('#')[0].length);
    const prefix = value.trimStart().startsWith('!!!') ? '!!!' : '';
    const replacement = match[1] !== undefined ? `<[${prefix}${move[1]}${suffix}]>` : `[[${prefix}${move[1]}${suffix}]]`;
    text = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  }
  return text;
}
function rewriteLinks(text, moves) {
  // Structured documents contain JSON strings: escape renamed paths through JSON
  // serialization so quotes and backslashes in filenames cannot corrupt a canvas.
  const fence = /```stillnote-(canvas|spreadsheet|graph|tasks|geometry|calculator3d)\s*\n([\s\S]*?)\n```/g;
  let offset = 0, result = '', match;
  while ((match = fence.exec(text))) {
    result += rewritePlainLinks(text.slice(offset, match.index), moves);
    let replacement = match[0];
    try {
      const original = JSON.parse(match[2]);
      const visit = value => typeof value === 'string' ? rewritePlainLinks(value, moves)
        : Array.isArray(value) ? value.map(visit)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)])) : value;
      const updated = visit(original);
      if (JSON.stringify(original) !== JSON.stringify(updated)) replacement = '```stillnote-' + match[1] + '\n' + JSON.stringify(updated, null, 2) + '\n```';
    } catch { /* Leave malformed structured content intact for recovery. */ }
    result += replacement; offset = match.index + match[0].length;
  }
  return result + rewritePlainLinks(text.slice(offset), moves);
}
module.exports = { linksIn, matchesPath, rewriteLinks };
