import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/media-resize.js', import.meta.url), 'utf8');
const { resizedMediaSize } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('landscape and portrait photos keep their original ratios', () => {
  for (const ratio of [2, .5, 1, 16 / 9]) {
    for (const [dx, dy] of [[100, 50], [-100, -50], [0, 150], [150, 0]]) {
      const size = resizedMediaSize(200, 200 / ratio, dx, dy, ratio, 800);
      assert(Math.abs(size.width / size.height - ratio) < 1e-10);
      assert(size.width > 0 && size.width <= 800);
    }
  }
});
test('3D width and height resize independently', () => {
  assert.deepEqual(resizedMediaSize(420, 260, 100, 0, 0, 900), { width: 520, height: 260 });
  assert.deepEqual(resizedMediaSize(420, 260, 0, 100, 0, 900), { width: 420, height: 360 });
});
test('sizes stay positive, fit narrow editors, and respect maximums', () => {
  assert.deepEqual(resizedMediaSize(420, 260, -1000, -1000, 0, 50), { width: 50, height: 80 });
  assert.deepEqual(resizedMediaSize(420, 260, 10000, 10000, 0, 600), { width: 600, height: 1200 });
  const photo = resizedMediaSize(200, 400, 10000, 10000, .5, 800);
  assert.deepEqual(photo, { width: 600, height: 1200 });
});
