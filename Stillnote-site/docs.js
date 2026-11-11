const guideSearch = document.querySelector('#docs-search');
const guideSections = [...document.querySelectorAll('.doc-section')];
const guideLinks = [...document.querySelectorAll('.docs-toc nav a')];
const guideClear = document.querySelector('#docs-clear');
const guideStatus = document.querySelector('#docs-status');
const sectionText = new Map(guideSections.map(section => [section.id, section.textContent.toLocaleLowerCase()]));
function filterGuide() {
  const terms = guideSearch.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let count = 0;
  guideSections.forEach((section, index) => {
    const matches = terms.every(term => sectionText.get(section.id).includes(term));
    section.hidden = !matches;
    guideLinks[index].hidden = !matches;
    if (matches) count++;
  });
  guideClear.hidden = !terms.length;
  document.querySelector('#docs-empty').hidden = count !== 0;
  guideStatus.textContent = terms.length ? `${count} of ${guideSections.length} sections match` : `${guideSections.length} sections · Search this guide`;
}
guideSearch.addEventListener('input', filterGuide);
guideClear.addEventListener('click', () => { guideSearch.value = ''; filterGuide(); updateActiveSection(); guideSearch.focus(); });
filterGuide();
function revealHash() {
  const target = guideSections.find(section => `#${section.id}` === location.hash);
  if (!target) return;
  if (target.hidden) { guideSearch.value = ''; filterGuide(); }
  target.scrollIntoView({ behavior: 'instant' });
}
window.addEventListener('hashchange', revealHash);
if (location.hash) requestAnimationFrame(revealHash);
// A single active entry follows the topmost visible section, including after filtering.
let guideFrame;
function updateActiveSection() {
  guideFrame = null;
  const visible = guideSections.filter(section => !section.hidden);
  let current = visible[0];
  for (const section of visible) { if (section.getBoundingClientRect().top <= 150) current = section; }
  guideLinks.forEach(link => {
    if (current && link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', () => { if (!guideFrame) guideFrame = requestAnimationFrame(updateActiveSection); }, { passive: true });
guideSearch.addEventListener('input', updateActiveSection);
updateActiveSection();
// Copy is progressive enhancement: examples remain selectable without clipboard access.
document.querySelectorAll('.doc-section pre').forEach(pre => {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'copy-code'; button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy syntax example');
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select text'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
  pre.append(button);
});
