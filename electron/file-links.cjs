const linkPattern = /<\[([^\]\r\n]+)\]>|\[\[([^\]\r\n]+)\]\]/g;
function linksIn(text) {
  return [...text.matchAll(linkPattern)].map((match) => {
    const value = match[1] ?? match[2];
    const target = value.split('|')[0].split('#')[0].trim();
    return { match, value, target, line: text.slice(0, match.index).split('\n').length };
  });
}
function matchesPath(target, file) {
  const clean = target.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return clean === file.toLowerCase() || (!/\.[^/]+$/.test(clean) && `${clean}.md` === file.toLowerCase());
}
function rewriteLinks(text, moves) {
  const references = linksIn(text);
  for (const { match, value, target } of references.reverse()) {
    const move = moves.find(([oldPath]) => matchesPath(target, oldPath));
    if (!move) continue;
    const suffix = value.slice(value.split('|')[0].split('#')[0].length);
    const replacement = match[1] !== undefined ? `<[${move[1]}${suffix}]>` : `[[${move[1]}${suffix}]]`;
    text = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  }
  return text;
}
module.exports = { linksIn, matchesPath, rewriteLinks };
