const previewSizes = new Map();

export function resizedMediaSize(width, height, dx, dy, aspectRatio, maxWidth) {
  const limit = Math.max(1, maxWidth);
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  if (aspectRatio > 0) {
    const maximum = Math.min(limit, 1200 * aspectRatio);
    const delta = (dx + dy / aspectRatio) / (1 + 1 / aspectRatio ** 2);
    const nextWidth = clamp(width + delta, Math.min(64, maximum), maximum);
    return { width: nextWidth, height: nextWidth / aspectRatio };
  }
  return { width: clamp(width + dx, Math.min(100, limit), limit), height: clamp(height + dy, 80, 1200) };
}

export function attachMediaResize(preview, view, key, image = null) {
  const handle = document.createElement('button');
  handle.type = 'button'; handle.className = 'media-resize-handle';
  handle.setAttribute('aria-label', image ? 'Resize image, keeping aspect ratio' : 'Resize 3D preview');
  handle.title = 'Drag to resize · Arrow keys to resize';
  handle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M8 12l4-4M12 12h.01"/></svg>';
  preview.append(handle);
  let drag = null;
  const ratio = () => image ? image.naturalWidth / image.naturalHeight : 0;
  const availableWidth = () => Math.max(1, (preview.closest('.cm-content')?.clientWidth || preview.parentElement.clientWidth) - 8);
  const apply = (size) => {
    preview.classList.add('is-resized');
    preview.style.width = `${size.width + 2}px`;
    if (!image) preview.style.height = `${size.height + 2}px`;
    previewSizes.set(key, size);
    view.requestMeasure();
  };
  const restore = () => {
    const size = previewSizes.get(key);
    if (size && (!image || ratio() > 0)) apply(resizedMediaSize(size.width, size.height, 0, 0, ratio(), availableWidth()));
  };
  if (image && !image.complete) image.addEventListener('load', restore, { once: true });
  else restore();
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (image && !(ratio() > 0))) return;
    event.preventDefault(); event.stopPropagation();
    drag = { x: event.clientX, y: event.clientY, width: preview.clientWidth, height: preview.clientHeight };
    handle.setPointerCapture(event.pointerId);
    preview.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    apply(resizedMediaSize(drag.width, drag.height, event.clientX - drag.x, event.clientY - drag.y, ratio(), availableWidth()));
  });
  const finish = () => { drag = null; preview.classList.remove('is-resizing'); };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!delta || (image && !(ratio() > 0))) return;
    event.preventDefault(); event.stopPropagation();
    apply(resizedMediaSize(preview.clientWidth, preview.clientHeight, ...delta, ratio(), availableWidth()));
  });
}
