const dayMs = 86_400_000;
const calendarFormat = { timeZone: 'UTC', calendar: 'gregory' };
const monthFormat = new Intl.DateTimeFormat(undefined, { ...calendarFormat, month: 'long', year: 'numeric' });
const dateFormat = new Intl.DateTimeFormat(undefined, { ...calendarFormat, dateStyle: 'full' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { ...calendarFormat, weekday: 'short' });
const dayFormat = new Intl.NumberFormat(undefined);
const locale = new Intl.Locale(monthFormat.resolvedOptions().locale);
const weekStart = (locale.getWeekInfo?.().firstDay ?? 7) % 7;
const minDate = new Date('0001-01-01');
const maxDate = new Date('9999-12-31');
let calendarId = 0;
let errorId = 0;
let trackingCalendarPosition = false;

const addDays = (date, days) => new Date(+date + days * dayMs);
const weekOffset = date => (date.getUTCDay() - weekStart + 7) % 7;
const isoDate = date => date.toISOString().slice(0, 10);
const supportedDate = date => date >= minDate && date <= maxDate;

function addMonths(date, months) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months, 1);
  const lastDay = new Date(result);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay.getUTCDate()));
  return result;
}

function positionCalendar() {
  const panel = document.querySelector('.date-calendar:popover-open');
  if (!panel) return;
  const { left, top, bottom } = panel.parentElement.getBoundingClientRect();
  const inset = 8;
  const gap = 6;
  const height = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
  const below = innerHeight - bottom - gap - inset;
  const above = top - gap - inset;
  const opensBelow = height <= below || below >= above;
  panel.style.maxHeight = `${Math.floor(Math.min(innerHeight - inset * 2, opensBelow ? below : above))}px`;
  const y = opensBelow ? bottom + gap : top - gap - panel.offsetHeight;
  panel.style.left = `${Math.max(inset, Math.min(left, innerWidth - panel.offsetWidth - inset))}px`;
  panel.style.top = `${Math.max(inset, Math.min(y, innerHeight - panel.offsetHeight - inset))}px`;
}

export function addDatePickers(root, calendarIcon) {
  if (!trackingCalendarPosition) {
    trackingCalendarPosition = true;
    window.addEventListener('resize', positionCalendar);
    window.addEventListener('scroll', positionCalendar, true);
  }
  for (const field of root.querySelectorAll('input[type="date"]')) {
    const control = document.createElement('div');
    const trigger = document.createElement('button');
    const panel = document.createElement('div');
    const name = field.labels[0]?.textContent.trim().toLowerCase() || 'date';
    control.className = 'date-control';
    trigger.className = 'date-control-trigger';
    trigger.type = 'button';
    trigger.title = `Choose ${name.endsWith('date') ? name : `${name} date`}`;
    trigger.setAttribute('aria-label', trigger.title);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.innerHTML = calendarIcon;
    panel.id = `date-calendar-${++calendarId}`;
    panel.className = 'date-calendar';
    panel.popover = 'auto';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', trigger.title);
    trigger.popoverTargetElement = panel;
    field.before(control);
    control.append(field, trigger, panel);

    panel.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      if (field.disabled) { event.preventDefault(); return; }
      renderDateCalendar(panel, field, trigger);
    });
    panel.addEventListener('toggle', event => {
      if (event.newState === 'open') positionCalendar();
      else panel.replaceChildren();
    });
    field.addEventListener('keydown', event => {
      if (event.key === 'F4' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown')) {
        event.preventDefault();
        trigger.click();
      }
    });
  }
}

function renderDateCalendar(panel, field, trigger) {
  const now = new Date();
  const today = new Date(isoDate(new Date(+now - now.getTimezoneOffset() * 60_000)));
  const selected = field.valueAsDate;
  let active = selected && supportedDate(selected) ? selected : today;
  panel.innerHTML = `
    <div class="date-calendar-header">
      <button type="button" data-previous aria-label="Previous month"><span aria-hidden="true"></span></button>
      <span id="${panel.id}-month" class="date-calendar-month" aria-live="polite"></span>
      <button type="button" data-next aria-label="Next month"><span aria-hidden="true"></span></button>
    </div>
    <div class="date-calendar-grid" role="grid" aria-labelledby="${panel.id}-month"></div>
    <div class="date-calendar-actions">
      <button type="button" data-today>Today</button>
      <button type="button" data-clear ${field.required || !field.value ? 'hidden' : ''}>Clear date</button>
    </div>`;
  const month = panel.querySelector('.date-calendar-month');
  const grid = panel.querySelector('.date-calendar-grid');
  const prev = panel.querySelector('[data-previous]');
  const next = panel.querySelector('[data-next]');

  function choose(value) {
    panel.hidePopover();
    trigger.focus();
    if (field.disabled || field.value === value) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function paint(focusDay = false) {
    const first = new Date(active);
    first.setUTCDate(1);
    const firstCell = addDays(first, -weekOffset(first));
    const activeValue = isoDate(active);
    month.textContent = monthFormat.format(active);
    prev.disabled = !supportedDate(addMonths(active, -1));
    next.disabled = !supportedDate(addMonths(active, 1));
    const headings = document.createElement('div');
    headings.className = 'date-calendar-weekdays';
    headings.setAttribute('role', 'row');
    for (let index = 0; index < 7; index++) {
      const heading = document.createElement('span');
      heading.setAttribute('role', 'columnheader');
      heading.textContent = weekdayFormat.format(addDays(firstCell, index));
      headings.append(heading);
    }
    const weeks = Array.from({ length: 6 }, (_, week) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      for (let index = 0; index < 7; index++) {
        const date = addDays(firstCell, week * 7 + index);
        const cell = document.createElement('span');
        cell.setAttribute('role', 'gridcell');
        row.append(cell);
        if (!supportedDate(date)) continue;
        const value = isoDate(date);
        cell.setAttribute('aria-selected', String(selected !== null && +date === +selected));
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.date = value;
        button.tabIndex = value === activeValue ? 0 : -1;
        button.classList.toggle('is-outside-month', date.getUTCMonth() !== active.getUTCMonth());
        if (+date === +today) button.setAttribute('aria-current', 'date');
        button.setAttribute('aria-label', dateFormat.format(date));
        button.textContent = dayFormat.format(date.getUTCDate());
        cell.append(button);
      }
      return row;
    });
    grid.replaceChildren(headings, ...weeks);
    if (focusDay) grid.querySelector('[tabindex="0"]').focus();
  }

  prev.addEventListener('click', () => { active = addMonths(active, -1); paint(); });
  next.addEventListener('click', () => { active = addMonths(active, 1); paint(); });
  panel.querySelector('[data-today]').addEventListener('click', () => choose(isoDate(today)));
  panel.querySelector('[data-clear]').addEventListener('click', () => choose(''));
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if (button) choose(button.dataset.date);
  });
  grid.addEventListener('keydown', event => {
    if (!event.target.matches('[data-date]') || event.ctrlKey || event.metaKey || event.altKey) return;
    const date = new Date(event.target.dataset.date);
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekOffset(date), End: 6 - weekOffset(date) };
    const months = event.shiftKey ? 12 : 1;
    let target;
    if (Object.hasOwn(offsets, event.key)) target = addDays(date, offsets[event.key]);
    else if (event.key === 'PageUp') target = addMonths(date, -months);
    else if (event.key === 'PageDown') target = addMonths(date, months);
    else return;
    event.preventDefault();
    active = new Date(Math.max(+minDate, Math.min(+maxDate, +target)));
    paint(true);
  });
  paint();
  grid.querySelector('[tabindex="0"]').autofocus = true;
}

function validationMessage(field) {
  const { valueMissing, badInput, patternMismatch } = field.validity;
  if (badInput && field.type === 'date') return 'Enter a valid date.';
  if (valueMissing) return field.dataset.requiredMessage || 'Please fill out this field.';
  if (patternMismatch && field.dataset.formatMessage) return field.dataset.formatMessage;
  return field.validationMessage;
}

export function styleFormValidation(form) {
  const errors = new Map();
  let handlingInvalid = false;

  function clear(field, message) {
    message.remove();
    const describedBy = field.getAttribute('aria-describedby')?.split(/\s+/).filter(id => id !== message.id);
    if (describedBy?.length) field.setAttribute('aria-describedby', describedBy.join(' '));
    else field.removeAttribute('aria-describedby');
    field.removeAttribute('aria-invalid');
    errors.delete(field);
  }

  form.addEventListener('invalid', event => {
    event.preventDefault();
    const field = event.target;
    let message = errors.get(field);
    if (!message) {
      message = document.createElement('span');
      message.id = `field-error-${++errorId}`;
      message.className = 'form-field-error';
      message.setAttribute('role', 'alert');
      const anchor = field.closest('.date-control, label') || field;
      anchor.after(message);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '));
      field.setAttribute('aria-invalid', 'true');
      errors.set(field, message);
    }
    const text = validationMessage(field);
    if (message.textContent !== text) message.textContent = text;
    if (handlingInvalid) return;
    handlingInvalid = true;
    queueMicrotask(() => { handlingInvalid = false; });
    field.focus();
  }, true);

  const updateErrors = () => {
    for (const [field, message] of errors) {
      if (!field.willValidate || field.validity.valid) clear(field, message);
      else {
        const text = validationMessage(field);
        if (message.textContent !== text) message.textContent = text;
      }
    }
  };
  const clearAll = () => { for (const [field, message] of errors) clear(field, message); };
  form.addEventListener('input', updateErrors);
  form.addEventListener('change', updateErrors);
  form.addEventListener('reset', clearAll);
  form.closest('dialog')?.addEventListener('close', clearAll);
}
