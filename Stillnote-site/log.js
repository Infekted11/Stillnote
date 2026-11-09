// Markdown is rendered as text nodes, never raw HTML. Supported: headings,
// paragraphs, bullet/numbered lists, bold, emphasis, inline code, and safe links.
function appendInline(parent, text) {
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    let node;
    if (match[1]) {
      node = document.createElement('a');
      try {
        const url = new URL(match[2], window.location.href);
        if (['http:', 'https:', 'mailto:'].includes(url.protocol)) node.href = url.href;
      } catch { /* Invalid URLs remain plain link text. */ }
      node.textContent = match[1];
    } else {
      node = document.createElement(match[3] ? 'strong' : match[4] ? 'code' : 'em');
      node.textContent = match[3] || match[4] || match[5];
    }
    parent.append(node);
    start = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}
function renderLog(markdown) {
  const fragment = document.createDocumentFragment();
  let container = fragment;
  let list = null;
  let paragraph = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(line);
    if (!line.trim()) { list = null; paragraph = null; continue; }
    if (heading) {
      list = null; paragraph = null;
      if (heading[1].length === 1) continue; // The page already supplies its title.
      if (heading[1].length === 2) {
        container = document.createElement('article');
        container.className = 'log-entry';
        fragment.append(container);
      }
      const node = document.createElement(`h${heading[1].length}`);
      appendInline(node, heading[2]);
      container.append(node);
    } else if (item) {
      paragraph = null;
      const tag = item[1] ? 'ul' : 'ol';
      if (!list || list.localName !== tag) { list = document.createElement(tag); container.append(list); }
      const node = document.createElement('li');
      appendInline(node, item[2]);
      list.append(node);
    } else {
      list = null;
      if (!paragraph) { paragraph = document.createElement('p'); container.append(paragraph); }
      else paragraph.append(document.createTextNode(' '));
      appendInline(paragraph, line);
    }
  }
  return fragment;
}
async function loadLog() {
  const content = document.querySelector('#log-content');
  try {
    const response = await fetch('changelog.md', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Unable to fetch log');
    const markdown = await response.text();
    content.replaceChildren(renderLog(markdown));
    if (!content.textContent.trim()) content.textContent = 'No updates yet. Check back soon.';
  } catch {
    const message = document.createElement('p');
    message.textContent = 'The log couldn’t load. Please try again, or read the Markdown source above.';
    const retry = document.createElement('button');
    retry.className = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', loadLog);
    content.replaceChildren(message, retry);
  } finally { content.setAttribute('aria-busy', 'false'); }
}
loadLog();
