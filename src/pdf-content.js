const mediaExtension = /\.(?:mp4|webm|ogv|mov|m4v|mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:[?#].*)?$/i;
// Work from the whole document, including content outside CodeMirror's viewport.
export async function preparePdfContent(markdown, render) {
  const replacements = new Map();
  let prefix = 'STILLNOTEPDFCONTENT';
  while (markdown.includes(prefix)) prefix += 'X';
  const token = html => { if (!html) return ''; const key = `${prefix}${replacements.size}END`; replacements.set(key, html); return key; };
  const pattern = /```[^\n]*\n[\s\S]*?(?:```|$)|`+[^`\n]*`+|<\[([^\]\n]+)\]>|\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\(([^)\n]+)\)|(?<!\$)\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\$)|;;([^;\n]+)\/([^;\n]+);;|(?<!\S)=([^=\n]+)=(?=$|[\s.,!?;:)\]}])/g;
  let result = '', offset = 0;
  for (const match of markdown.matchAll(pattern)) {
    result += markdown.slice(offset, match.index); offset = match.index + match[0].length;
    if (match[0].startsWith('`')) { result += match[0]; continue; }
    let html;
    if (match[1] !== undefined || match[2] !== undefined) {
      const reference = match[1] ?? match[2], target = reference.split('|')[0].trim();
      const linkOnly = target.startsWith('!!!'), clean = linkOnly ? target.slice(3) : target;
      if (mediaExtension.test(clean)) html = '';
      else if (linkOnly) html = `<span class="wiki-link">${render.escape(reference.includes('|') ? reference.slice(reference.indexOf('|')+1) : clean)}</span>`;
      else html = await render.link(target);
    } else if (match[5] !== undefined) {
      const target = match[5].trim();
      if (mediaExtension.test(target)) html = '';
      else if (match[3]) html = await render.image(target, match[4]);
    } else if (match[6] !== undefined) html = await render.equation(match[6]);
    else if (match[7] !== undefined) html = await render.task(match[7],match[8]);
    else if (match[9] !== undefined) html = `<mark>${render.escape(match[9])}</mark>`;
    result += html === undefined || html === null ? match[0] : token(html);
  }
  return { markdown: result + markdown.slice(offset), replacements };
}
