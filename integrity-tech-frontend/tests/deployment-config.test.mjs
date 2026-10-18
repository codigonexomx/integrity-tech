import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
function load(extra) {
  const env = { ...process.env };
  delete env.BACKEND_URL; delete env.VERCEL;
  return spawnSync(process.execPath, ['-e', 'require("./next.config.js")'], { cwd: new URL('../', import.meta.url), env: { ...env, ...extra }, encoding: 'utf8' });
}
test('Vercel cannot silently deploy rewrites pointing to localhost', () => {
  const result = load({ VERCEL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BACKEND_URL es obligatorio/);
});
test('explicit container and public backend origins are accepted', () => {
  for (const BACKEND_URL of ['http://backend:3001', 'https://api.example.test']) assert.equal(load({ BACKEND_URL }).status, 0);
});
test('backend credentials and paths cannot leak through rewrite configuration', () => {
  for (const BACKEND_URL of ['https://user:password@example.test', 'https://example.test/api', 'ftp://example.test']) assert.notEqual(load({ BACKEND_URL }).status, 0);
});
