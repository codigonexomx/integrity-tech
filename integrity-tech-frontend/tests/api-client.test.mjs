import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

function loadApiClientModule(overrides = {}) {
  const source = readFileSync(new URL('../src/services/api-client.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: () => ({}),
    process,
    Headers,
    FormData,
    crypto: { randomUUID },
    fetch: async () => {
      throw new Error('fetch should not run in this test');
    },
    ...overrides,
  };
  vm.runInNewContext(outputText, sandbox, { filename: 'api-client.ts' });
  return module.exports;
}

test('ApiClientError maps expected backend error statuses', () => {
  const { ApiClientError } = loadApiClientModule();

  const cases = [
    [401, 'isAuthError'],
    [403, 'isForbidden'],
    [409, 'isConflict'],
    [429, 'isRateLimited'],
    [503, 'isServerError'],
  ];

  for (const [status, property] of cases) {
    const error = ApiClientError.fromPayload(status, {
      message: `status-${status}`,
      requestId: 'req-test',
      traceId: 'trace-test',
      error: 'TestError',
    });

    assert.equal(error.status, status);
    assert.equal(error[property], true);
    assert.equal(error.requestId, 'req-test');
    assert.equal(error.traceId, 'trace-test');
    assert.equal(error.message, `status-${status}`);
  }
});


test('private reads bypass stale snapshots and candidate access does not replace staff access', async () => {
  const values = new Map([['auth-token', 'staff'], ['candidate-token:attempt-1', 'candidate']]);
  const requests = [];
  const { apiRawRequest } = loadApiClientModule({
    window: {}, localStorage: { getItem: key => values.get(key) },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
  });
  await apiRawRequest('/evaluations/attempts/attempt-1/session');
  await apiRawRequest('/evaluations/attempts/attempt-1/session');
  await apiRawRequest('/evaluations/attempts/attempt-1');
  assert.notEqual(requests[0].url, requests[1].url);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers.get('Authorization'), 'Bearer candidate');
  assert.equal(requests[2].options.headers.get('Authorization'), 'Bearer staff');
});
