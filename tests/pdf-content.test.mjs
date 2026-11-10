import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const moduleSource = await readFile(new URL('../src/pdf-content.js', import.meta.url), 'utf8');
const { preparePdfContent } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const app = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const escape = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const context = vm.createContext({ escapeHtml:escape });
vm.runInContext(app.slice(app.indexOf('function inlineMarkdownForPdf('), app.indexOf('async function prepareNotePdf(')),context);
function renderers() {
  const calls = [];
  return { calls, escape,
    link: async path => { calls.push(path); return /\.(png|md)/.test(path) ? `<span class="pdf-embed">Rendered ${escape(path)}</span>` : undefined; },
    image: async (path,label) => `<img src="data:image/png;base64,AAAA" alt="${escape(label)}">`,
    equation: async source => `<math><mi>${escape(source)}</mi></math>`,
    task: async (list,title) => `<span class="pdf-task">${escape(list)}: ${escape(title)}</span>`,
  };
}
test('PDF expands rendered links across the whole note and retains spreadsheet ranges', async () => {
  const render = renderers();
  const markdown = 'Title\n<[Images/photo.png]>\n' + 'Text\n'.repeat(100) + '<[Canvas.md]>\n[[Budget.md#A5,D8|Budget]]';
  const prepared = await preparePdfContent(markdown,render);
  const html = context.renderMarkdownForPdf(prepared.markdown,'Title',prepared.replacements);
  assert.deepEqual(render.calls,['Images/photo.png','Canvas.md','Budget.md#A5,D8']);
  assert.match(html,/Rendered Images\/photo.png/); assert.match(html,/Rendered Budget.md#A5,D8/);
  assert.doesNotMatch(html,/STILLNOTEPDFCONTENT/);
});
test('PDF omits audio and video links, embeds, labels and unresolved file references', async () => {
  const render = renderers();
  const prepared = await preparePdfContent('Before <[Song.MP3|Listen here]> after\n[[Missing.mov]]\n[Watch](https://example.com/movie.mp4?download=1)\n![Audio](voice.wav)\n<[track.opus#L2]>\nKeep this sentence.', render);
  const html = context.renderMarkdownForPdf(prepared.markdown,'Title',prepared.replacements);
  assert.doesNotMatch(html,/Listen here|Missing.mov|Watch|movie.mp4|voice.wav|track.opus|Song.MP3/);
  assert.match(html,/Before  after/); assert.match(html,/Keep this sentence/);
  assert.deepEqual(render.calls,[]);
});
test('code examples remain literal while equations, tasks, highlights and markdown images render', async () => {
  const source = '`<[Song.mp3]>`\n```md\n<[Canvas.md]>\n$literal$\n```\n$\\frac{a}{b}$ and =important=\n;;Work/Plan;;\n![Picture](photo.png)';
  const render = renderers(), prepared = await preparePdfContent(source, render);
  const html = context.renderMarkdownForPdf(prepared.markdown,'Title',prepared.replacements);
  assert.match(html,/<code>&lt;\[Song.mp3\]&gt;<\/code>/);
  assert.match(html,/&lt;\[Canvas.md\]&gt;/); assert.match(html,/\$literal\$/);
  assert.match(html,/<math>/); assert.match(html,/<mark>important<\/mark>/);
  assert.match(html,/class="pdf-task">Work: Plan/); assert.match(html,/alt="Picture"/);
  assert.deepEqual(render.calls,[]);
});
test('ordinary file links, Markdown formatting and HTML escaping remain intact', async () => {
  const render = renderers(); render.link = async () => undefined;
  const prepared = await preparePdfContent('**Bold** and *italic* <[Plan.md|My plan]> <script>alert(1)</script>',render);
  const html = context.renderMarkdownForPdf(prepared.markdown,'Title',prepared.replacements);
  assert.match(html,/<strong>Bold<\/strong>/); assert.match(html,/<em>italic<\/em>/);
  assert.match(html,/class="wiki-link">My plan/); assert.doesNotMatch(html,/<script>/);
});
test('PDF placeholders cannot collide with source text', async () => {
  const prepared = await preparePdfContent('STILLNOTEPDFCONTENT0END\n<[Canvas.md]>',renderers());
  const html = context.renderMarkdownForPdf(prepared.markdown,'Title',prepared.replacements);
  assert.match(html,/STILLNOTEPDFCONTENT0END/); assert.match(html,/Rendered Canvas.md/);
});
