// End-to-end recovery drill with NEW fictitious source and target projects only.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import { root, readEnv, run, composeArgs } from './pilot-common.mjs';
const start = Date.now();
const temporary = mkdtempSync(join(tmpdir(), 'integrity-recovery-drill-'));
const suffix = Date.now().toString();
const source = `integrity-recovery-source-${suffix}`;
const target = `integrity-restore-drill-${suffix}`;
const envFile = join(temporary, 'source.env');
const targetEnv = join(temporary, 'target.env');
const output = join(root, 'output/recovery-readiness'); mkdirSync(output, { recursive: true });
rmSync(join(output, 'verification.json'), { force: true });
let sourceStarted = false, targetStarted = false;
const compose = composeArgs(envFile, source);
const restoreCompose = composeArgs(targetEnv, target);
const node = process.execPath;
function exec(args, input) { return run('docker', [...compose, ...args], { input }); }
function api(port, ca) {
  return async (path, data, token) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'localhost', port, path: '/api' + path, method: data === undefined ? 'GET' : 'POST', ca, timeout: 15000,
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let raw = ''; res.on('data', chunk => raw += chunk); res.on('end', () => {
        try { assert.ok(res.statusCode < 300, `HTTP ${res.statusCode} en ${path}`); resolve(JSON.parse(raw)); } catch (error) { reject(error); }
      });
    }); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('HTTP timeout'))); if (data !== undefined) req.write(JSON.stringify(data)); req.end();
  });
}
try {
  run(node, [join(root, 'scripts/setup-pilot.mjs'), '--output', envFile]);
  let envText = readFileSync(envFile, 'utf8').replace('PILOT_HTTP_PORT=8080', 'PILOT_HTTP_PORT=18082').replaceAll(':8443', ':18445').replace('PILOT_HTTPS_PORT=8443', 'PILOT_HTTPS_PORT=18445').replace('PILOT_ORGANIZATION=piloto', 'PILOT_ORGANIZATION=recuperacion').replace('PILOT_ADMIN_EMAIL=admin@piloto.local', 'PILOT_ADMIN_EMAIL=recovery@example.test');
  writeFileSync(envFile, envText, { mode: 0o600 });
  sourceStarted = true;
  exec(['up', '-d', '--no-build', '--wait']);
  run(node, [join(root, 'scripts/bootstrap-pilot.mjs'), '--env-file', envFile, '--project', source]);
  exec(['cp', 'gateway:/data/caddy/pki/authorities/local/root.crt', join(temporary, 'source-ca.crt')]);
  const request = api(18445, readFileSync(join(temporary, 'source-ca.crt')));
  const config = readEnv(envFile);
  const credentials = { email: config.PILOT_ADMIN_EMAIL, password: config.PILOT_ADMIN_PASSWORD, organizationSlug: config.PILOT_ORGANIZATION };
  const staff = await request('/auth/login', credentials);
  const exam = (await request('/exams', undefined, staff.accessToken)).find(e => e.title.includes('Práctica'));
  assert.ok(exam);
  const invitation = await request('/evaluations/invitations', { candidateName: 'Prueba Recuperacion', email: 'recovery-candidate@example.test', examId: exam.id }, staff.accessToken);
  const candidate = await request('/evaluations/invitations/claim', { accessCode: invitation.accessCode, candidateName: 'Prueba Recuperacion', email: 'recovery-candidate@example.test' });
  const base = `/evaluations/attempts/${candidate.attemptId}`;
  await request(base + '/consent', { consentVersion: 'pilot-consent-v1' }, candidate.token);
  const session = await request(base + '/session', undefined, candidate.token);
  for (const question of session.questions) await request(base + '/submit', { questionId: question.id, itemVersionId: question.itemVersionId, response: { selectedOptionId: question.content.text.includes('3 cajas') ? 'b' : question.content.text.includes('revisar un dato') ? 'a' : 'c' } }, candidate.token);
  await request(base + '/finalize', {}, candidate.token);
  const before = await request(base, undefined, staff.accessToken); assert.match(before.overallScore, /^3 puntos/);
  exec(['exec', '-T', 'backend', 'node', '-e', "require('fs').writeFileSync('/app/.private-storage/recovery-fixture.txt','fictitious-private-recovery-fixture\\n',{mode:0o600})"]);
  exec(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli SET integrity-recovery-fixture fictitious-persisted-value']);
  const backupStart = Date.now();
  run(node, [join(root, 'scripts/backup-pilot.mjs'), '--env-file', envFile, '--project', source, '--output-dir', temporary]);
  const backup = join(temporary, readdirSync(temporary).find(name => name.endsWith('.itp')));
  // Tamper rejection must occur before a target environment or volumes are created.
  const corrupted = readFileSync(backup); corrupted[corrupted.length - 1] ^= 1; writeFileSync(join(temporary, 'corrupt.itp'), corrupted, { mode: 0o600 });
  let tamperRejected = false;
  try { run(node, [join(root, 'scripts/restore-pilot.mjs'), join(temporary, 'corrupt.itp'), '--env-file', envFile, '--project', `integrity-restore-corrupt-${suffix}`, '--target-env', join(temporary, 'corrupt.env')]); } catch { tamperRejected = true; }
  assert.ok(tamperRejected);
  const restoreStart = Date.now(); targetStarted = true;
  run(node, [join(root, 'scripts/restore-pilot.mjs'), backup, '--env-file', envFile, '--project', target, '--target-env', targetEnv, '--http-port', '18083', '--https-port', '18446']);
  run('docker', [...restoreCompose, 'cp', 'gateway:/data/caddy/pki/authorities/local/root.crt', join(temporary, 'target-ca.crt')]);
  const restored = api(18446, readFileSync(join(temporary, 'target-ca.crt')));
  const newStaff = await restored('/auth/login', credentials);
  const after = await restored(base, undefined, newStaff.accessToken);
  assert.equal(after.overallScore, before.overallScore); assert.equal(after.date, before.date);
  const file = run('docker', [...restoreCompose, 'exec', '-T', 'backend', 'node', '-e', "process.stdout.write(require('fs').readFileSync('/app/.private-storage/recovery-fixture.txt'))"]).toString();
  assert.equal(file, 'fictitious-private-recovery-fixture\n');
  const redis = run('docker', [...restoreCompose, 'exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw GET integrity-recovery-fixture']).toString().trim();
  assert.equal(redis, 'fictitious-persisted-value');
  let refusedExisting = false;
  try { run(node, [join(root, 'scripts/restore-pilot.mjs'), backup, '--env-file', envFile, '--project', target, '--target-env', targetEnv]); } catch { refusedExisting = true; }
  assert.ok(refusedExisting);
  const report = { checkedAt: new Date().toISOString(), fictionalDataOnly: true, sourceProject: source, targetProject: target, checks: { fullCandidateFlowBeforeBackup: true, authenticatedEncryptedBackup: true, tamperedBackupRejected: tamperRejected, restoredDatabaseReportAndDateMatch: true, restoredPrivateFileBytesMatch: true, restoredRedisValueMatches: true, loginThroughVerifiedLocalHTTPS: true, existingDestinationRefused: refusedExisting }, elapsedMs: Date.now() - start, backupAndRecoveryMs: Date.now() - backupStart, recoveryAndChecksMs: Date.now() - restoreStart, scope: 'local_isolated_not_remote_acceptance' };
  writeFileSync(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  // These project names are created by this script; never delete the live pilot.
  let cleanupFailed = false;
  for (const [started, file, args] of [[targetStarted, targetEnv, restoreCompose], [sourceStarted, envFile, compose]]) {
    if (started && existsSync(file)) {
      try { run('docker', [...args, 'down', '-v', '--remove-orphans']); }
      catch { cleanupFailed = true; }
    }
  }
  if (cleanupFailed) throw new Error(`No se completó la limpieza del ensayo; se conserva el entorno protegido en ${temporary} para recuperación manual.`);
  rmSync(temporary, { recursive: true, force: true });
}
