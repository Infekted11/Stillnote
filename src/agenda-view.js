export function createAgendaView(panel, { icons, openLink, fileLabel }) {
  const status = panel.querySelector('[role=status]');
  const lists = { now: panel.querySelector('[data-agenda-now]'), upcoming: panel.querySelector('[data-agenda-upcoming]') };
  const cards = new Map();
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
  const formatDate = value => formatter.format(new Date(value.slice(0, 10) + 'T00:00Z'));
  const formatTime = value => `${formatDate(value)}, ${value.slice(11)}`;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const linkButton = (link, label) => {
    const button = element('button', 'agenda-link', label);
    button.type = 'button';
    button.title = link.file ? link.file + (link.fragment ? '#' + link.fragment : '') : link.url;
    button.addEventListener('click', () => openLink(link));
    return button;
  };

  function buildCard(task, open) {
    const card = element('li', 'agenda-card');
    const header = element('div', 'agenda-card-source');
    header.innerHTML = task.kind === 'gantt' ? icons.gantt : icons.tasks;
    header.append(task.origin ? linkButton(task.origin, task.source) : document.createTextNode(task.source));
    if (task.cached) header.append(element('span', 'agenda-cached', 'Cached'));
    const title = element('h3', 'agenda-card-title', task.instanceNumber ? `${task.title} · Instance ${task.instanceNumber}` : task.title);
    const schedule = element('p', 'agenda-schedule');
    const dates = task.kind === 'gantt' ? (task.allDay ? formatDate : formatTime) : null;
    if (dates) {
      schedule.textContent = task.milestone ? `Milestone · ${dates(task.start)}`
        : `${dates(task.start)} – ${dates(task.end)}${task.allDay ? ' · All day' : ''}`;
    } else {
      schedule.textContent = task.due ? `${task.overdue ? 'Overdue' : 'Due'} ${formatDate(task.due)}` : 'No due date';
    }
    card.append(header, title, schedule);

    let progress;
    if (task.kind === 'gantt') {
      const track = element('div', 'agenda-progress');
      progress = element('progress', 'agenda-progress-bar');
      progress.max = 100;
      progress.setAttribute('aria-label', 'Scheduled time elapsed');
      track.append(progress, element('span', 'agenda-progress-value'));
      card.append(track);
    }

    const details = element('details', 'agenda-details');
    details.open = open;
    const summary = element('summary', 'agenda-summary');
    summary.innerHTML = `<span class="agenda-show-more">Show more</span><span class="agenda-show-less">Show less</span>${icons.down}`;
    details.append(summary);
    if (task.details) {
      const description = element('p', 'agenda-description', task.details);
      description.title = task.details;
      details.append(description);
    }
    if (task.links.length) {
      const links = element('ul', 'agenda-links');
      for (const link of task.links) {
        const line = /^L(\d+)$/i.exec(link.fragment);
        const number = /^task-(\d+)$/.exec(link.fragment);
        const label = link.file
          ? fileLabel(link.file) + (line ? ` · Line ${line[1]}` : number ? ` · Task ${number[1]}` : '')
          : link.label;
        const item = element('li', '');
        item.append(linkButton(link, label));
        links.append(item);
      }
      details.append(links);
    } else if (!task.details) {
      details.append(element('p', 'agenda-empty', 'No details or linked places.'));
    }
    card.append(details);
    return { card, details, progress };
  }

  return function render(snapshot, message = '') {
    status.textContent = message || (snapshot.googleStatus === 'unavailable' ? 'Some Google Tasks could not sync. Saved task sheets are shown where available.' : '');
    status.hidden = !status.textContent;
    const visible = new Set();
    for (const [section, list] of Object.entries(lists)) {
      const children = [];
      for (const { progress, ...task } of snapshot[section]) {
        const key = task.kind + task.id;
        const signature = JSON.stringify(task);
        let view = cards.get(key);
        if (view?.signature !== signature) {
          view = { ...buildCard(task, view?.details.open ?? false), signature };
          cards.set(key, view);
        }
        if (view.progress) {
          view.progress.value = progress;
          view.progress.nextElementSibling.textContent = `${progress}%`;
        }
        visible.add(key);
        children.push(view.card);
      }
      if (!children.length && message !== 'Loading agenda…') {
        children.push(element('li', 'agenda-empty', section === 'now' ? 'Nothing on the agenda right now.' : 'Nothing scheduled ahead.'));
      }
      for (const [index, child] of children.entries()) {
        if (list.children[index] !== child) list.insertBefore(child, list.children[index] || null);
      }
      while (list.children.length > children.length) list.lastElementChild.remove();
    }
    for (const key of cards.keys()) if (!visible.has(key)) cards.delete(key);
  };
}
