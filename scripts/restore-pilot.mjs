// Restores only into NEW isolated volumes; never replaces the live pilot.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { readEnv, run, composeArgs, backupKey, decryptBackup } from './pilot-common.mjs';

const { values, positionals } = parseArgs({ options: {
  project: { type: 'string' }, 'env-file': { type: 'string' }, 'target-env': { type: 'string' },
  'http-port': { type: 'string', default: '18080' }, 'https-port': { type: 'string', default: '18443' },
}, allowPositionals: true });
if (positionals.length !== 1 || !values['env-file'] || !values['target-env'] || !/^integrity-restore-[a-z0-9-]{1,40}$/.test(values.project || '')) {
  throw new Error('Uso: restore-pilot.mjs ARCHIVO.itp --project integrity-restore-NOMBRE --env-file ENV_ORIGINAL --target-env ENV_NUEVO [--http-port 18080 --https-port 18443]');
}
for (const value of [values['http-port'], values['https-port']]) if (!/^\d+$/.test(value) || +value < 1024 || +value > 65535 || ['8080', '8443'].includes(value)) throw new Error('Elige puertos aislados de 1024 a 65535 distintos de los del piloto.');
if (values['http-port'] === values['https-port']) throw new Error('Los puertos deben ser diferentes.');
const project = values.project;
for (const resource of ['container', 'volume']) {
  const ids = run('docker', [resource, 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).toString().trim();
  if (ids) throw new Error('El proyecto destino ya contiene recursos. Usa un nombre nuevo; no se sobrescribe nada.');
}
const config = readEnv(resolve(values['env-file']));
const temporary = mkdtempSync(join(tmpdir(), 'integrity-restore-'));
const targetEnv = resolve(values['target-env']);
const compose = composeArgs(targetEnv, project);
try {
  console.error('restore-phase: authentication');
  const archive = join(temporary, 'backup.tar.gz');
  await decryptBackup(resolve(positionals[0]), archive, backupKey(config));
  run('tar', ['-xzf', archive, '-C', temporary]);
  for (const name of ['private-files.tar', 'redis.tar.gz']) {
    console.error('restore-phase: archive-validation');
    const path = join(temporary, name);
    const members = run('tar', ['-tf', path]).toString().trim().split('\n');
    if (members.some(p => p.startsWith('/') || p.includes('\\') || p.split('/').includes('..'))) throw new Error('Ruta insegura en el respaldo.');
    const listing = run('tar', ['-tvf', path]).toString().trim().split('\n');
    if (listing.some(line => line && !['d', '-'].includes(line[0]))) throw new Error('No se permiten enlaces ni archivos especiales en recuperación.');
  }
  const env = { ...config, PILOT_DOMAIN: 'localhost', PILOT_ORIGIN: `https://localhost:${values['https-port']}`, PILOT_BIND_IP: '127.0.0.1', PILOT_HTTP_PORT: values['http-port'], PILOT_HTTPS_PORT: values['https-port'] };
  mkdirSync(dirname(targetEnv), { recursive: true, mode: 0o700 });
  writeFileSync(targetEnv, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  console.error('restore-phase: database-start');
  run('docker', [...compose, 'up', '-d', '--wait', 'postgres']);
  console.error('restore-phase: database-import');
  run('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'integrity', '-d', 'integrity_pilot', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(join(temporary, 'database.sql')) });
  console.error('restore-phase: create-volumes');
  run('docker', [...compose, 'create', '--no-build', 'backend', 'redis']);
  console.error('restore-phase: private-files');
  run('docker', [...compose, 'run', '--rm', '--no-deps', '--user', 'nodeapp', '--entrypoint', 'tar', 'backend', '-xf', '-', '-C', '/app/.private-storage'], { input: readFileSync(join(temporary, 'private-files.tar')) });
  console.error('restore-phase: redis-files');
  run('docker', [...compose, 'run', '--rm', '--no-deps', '--user', 'redis', '--entrypoint', 'tar', 'redis', '-xzf', '-', '-C', '/data'], { input: readFileSync(join(temporary, 'redis.tar.gz')) });
  console.error('restore-phase: application-start');
  run('docker', [...compose, 'up', '-d', '--no-build', '--wait']);
  console.log(JSON.stringify({ project, origin: env.PILOT_ORIGIN, targetEnv, restored: ['postgresql', 'private-files', 'redis'], status: 'isolated_services_started_verify_before_cutover' }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
