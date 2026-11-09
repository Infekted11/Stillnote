const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.site-header nav');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? 'Close' : 'Menu';
  nav.classList.toggle('open', open);
});

nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  if (menuButton) menuButton.textContent = 'Menu';
  nav.classList.remove('open');
}));

document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-demo]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('.demo-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === button.dataset.demo);
      if (panel.dataset.panel === button.dataset.demo) panel.scrollTop = 0;
    });
    document.querySelector('.app-window').dataset.demoView = button.dataset.demo;
    document.querySelector('.breadcrumbs').lastChild.textContent = button.textContent.trim();
  });
});

const sidebarToggle = document.querySelector('.sidebar-toggle');
sidebarToggle?.addEventListener('click', () => {
  const hidden = document.querySelector('.app-window').classList.toggle('sidebar-hidden');
  sidebarToggle.setAttribute('aria-expanded', String(!hidden));
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.13 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
