// Receiving inbox for feature request drafts.
const FEATURE_REQUEST_EMAIL = 'opmolina73@gmail.com';
const form = document.querySelector('#request-form');
const preview = document.querySelector('#draft-preview');
const status = document.querySelector('#request-status');
function requestDraft() {
  const data = new FormData(form);
  const title = data.get('title').trim();
  const body = `Feature request: ${title || '(your idea)'}\n\nWhat I’d like to do:\n${data.get('details').trim()}\n\nCurrent workaround / context:\n${data.get('context').trim() || 'Not provided'}\n\nPlatform: ${data.get('platform') || 'Not specified'}`;
  preview.value = body;
  return { subject: `Stillnote feature request: ${title}`, body };
}
form.addEventListener('input', requestDraft);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const draft = requestDraft();
  window.location.href = `mailto:${FEATURE_REQUEST_EMAIL}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  status.textContent = FEATURE_REQUEST_EMAIL ? 'Email draft requested. If your mail app didn’t open, use Copy draft.' : 'Email draft requested. Add the recipient in your mail app. You can also copy the draft below.';
});
document.querySelector('#copy-draft').addEventListener('click', async () => {
  const draft = requestDraft();
  try {
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    status.textContent = 'Draft copied. Paste it into your email app.';
  } catch {
    preview.focus();
    preview.select();
    status.textContent = 'Select and copy the draft below to paste it into your email app.';
  }
});
