import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeclaredCaps } from '../base44/shared/modelCapabilities.ts';
import { editKraiImage, validateImageInput } from '../base44/shared/kraiImageAdapter.ts';

const endpoint = 'https://connect.krai.es/api/gateway/v1';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=';
const input = { prompt: 'Corrige la luz', image_b64: png, image_mime_type: 'image/png' };

test('KRAI task arrays distinguish editing from vision and video', () => {
  assert.deepEqual(resolveDeclaredCaps({ capabilities: ['image_edit', 'image_generation'] }), { vision: false, image_edit: true, video: false });
  assert.deepEqual(resolveDeclaredCaps({ capabilities: ['chat', 'vision'] }), { vision: true, image_edit: false, video: false });
  assert.deepEqual(resolveDeclaredCaps({ capabilities: [] }), { vision: false, image_edit: false, video: false });
});
test('OpenRouter metadata continues to work', () => {
  assert.deepEqual(resolveDeclaredCaps({ architecture: { modality: 'text+image->text' } }), { vision: true, image_edit: null, video: null });
});
test('invalid format and oversized photos are rejected before transmission', () => {
  assert.throws(() => validateImageInput({ ...input, image_mime_type: 'image/jpeg' }));
  assert.throws(() => validateImageInput({ ...input, image_b64: 'A'.repeat(12 * 1024 * 1024) }));
  assert.throws(() => validateImageInput({ ...input, prompt: '' }));
});
test('uses canonical execution and preserves returned image bytes', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls++;
    assert.equal(url, endpoint + '/execute');
    assert.equal(opts.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(opts.body);
    assert.equal(body.task, 'image_edit'); assert.equal(body.engine_hint, 'gemini-image');
    assert.deepEqual(body.input, input); assert.equal(body.options.timeout_ms, 60000);
    return Response.json({ ok: true, artifacts: [{ type: 'image', mime_type: 'image/png', data_b64: png, width: 1, height: 1 }] });
  });
  const result = await editKraiImage(endpoint, 'test-key', 'gemini-image', input);
  assert.equal(result.artifacts[0].data_b64, png); assert.equal(calls, 1);
});
test('errors preserve useful detail and do not retry edits', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ detail: 'Sesión caducada test-key' }, { status: 502 }); });
  await assert.rejects(editKraiImage(endpoint, 'test-key', 'gemini-image', input), /Sesión caducada \[oculta\]/);
  assert.equal(calls, 1);
});
test('empty or invalid output is not accepted as a completed edit', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, artifacts: [] }));
  await assert.rejects(editKraiImage(endpoint, 'test-key', 'gemini-image', input), /no devolvió/);
});
