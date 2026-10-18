import { randomBytes, createCipheriv } from 'node:crypto';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, openSync, closeSync, appendFileSync, createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { root, readEnv, run, composeArgs, backupKey, decryptBackup } from './pilot-common.mjs';

const { values, positionals } = parseArgs({ options: {
  verify: { type: 'boolean' }, 'env-file': { type: 'string', default: join(root, '.env.pilot') },
  project: { type: 'string' }, 'output-dir': { type: 'string', default: join(root, 'pilot-backups') },
}, allowPositionals: true });
const envPath = resolve(values['env-file']);
const key = backupKey(readEnv(envPath));
const compose = composeArgs(envPath, values.project);
const temporary = mkdtempSync(join(tmpdir(), 'integrity-backup-'));
const lockPath = join(root, '.pilot-operation.lock');
let locked = false, output, restart = [], phase = 'initialize';
function toFile(args, path) {
  const fd = openSync(path, 'wx', 0o600);
  try { run('docker', args, { stdio: ['ignore', fd, 'pipe'] }); } finally { closeSync(fd); }
}
try {
  if (values.verify) {
    if (positionals.length !== 1) throw new Error('Uso: backup-pilot.mjs --verify ARCHIVO.itp');
    await decryptBackup(resolve(positionals[0]), join(temporary, 'verified.tar.gz'), key);
    console.log('Cifrado autenticado y tres componentes verificados; falta ensayar restauración.');
  } else {
    if (positionals.length) throw new Error('Argumentos no reconocidos.');
    const fd = openSync(lockPath, 'wx', 0o600); closeSync(fd); locked = true;
    phase = 'inspect-services';
    const running = run('docker', [...compose, 'ps', '--status', 'running', '--services']).toString().trim().split('\n');
    if (!running.includes('postgres') || !running.includes('redis')) throw new Error('PostgreSQL y Redis deben estar iniciados antes del respaldo.');
    restart = ['frontend', 'backend', 'redis'].filter(service => running.includes(service));
    phase = 'stop-applications';
    run('docker', [...compose, 'stop', 'frontend', 'backend']);
    phase = 'database-dump';
    toFile([...compose, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'integrity', '-d', 'integrity_pilot', '--no-owner', '--no-acl'], join(temporary, 'database.sql'));
    const backendId = run('docker', [...compose, 'ps', '-a', '-q', 'backend']).toString().trim();
    const redisId = run('docker', [...compose, 'ps', '-a', '-q', 'redis']).toString().trim();
    if (![backendId, redisId].every(id => /^[a-f0-9]+$/.test(id))) throw new Error('Contenedores no encontrados.');
    phase = 'stop-redis';
    run('docker', [...compose, 'stop', 'redis']);
    phase = 'copy-private-files';
    toFile(['cp', `${backendId}:/app/.private-storage/.`, '-'], join(temporary, 'private-files.tar'));
    phase = 'copy-redis-files';
    toFile(['cp', `${redisId}:/data/.`, '-'], join(temporary, 'redis.tar'));
    phase = 'compress-redis';
    const redisArchive = openSync(join(temporary, 'redis.tar.gz'), 'wx', 0o600);
    try { run('gzip', ['-c', join(temporary, 'redis.tar')], { stdio: ['ignore', redisArchive, 'pipe'] }); }
    finally { closeSync(redisArchive); }
    phase = 'archive-components';
    const archive = join(temporary, 'backup.tar.gz');
    run('tar', ['-czf', archive, '-C', temporary, 'database.sql', 'private-files.tar', 'redis.tar.gz']);
    const destination = resolve(values['output-dir']); mkdirSync(destination, { recursive: true, mode: 0o700 });
    output = join(destination, `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}.itp`);
    phase = 'encrypt';
    const header = Buffer.concat([Buffer.from('ITP1'), randomBytes(12)]);
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(4)); cipher.setAAD(header);
    writeFileSync(output, header, { mode: 0o600, flag: 'wx' });
    await pipeline(createReadStream(archive), cipher, createWriteStream(output, { flags: 'a' }));
    appendFileSync(output, cipher.getAuthTag());
    phase = 'verify';
    await decryptBackup(output, join(temporary, 'verified.tar.gz'), key);
    console.log(`Respaldo cifrado y autenticado: ${output}`);
    output = undefined;
  }
} catch (error) {
  console.error(`backup-phase: ${phase}`);
  throw error;
} finally {
  try {
    if (restart.includes('redis')) run('docker', [...compose, 'start', '--wait', 'redis']);
    const apps = restart.filter(s => s !== 'redis');
    if (apps.length) run('docker', [...compose, 'start', '--wait', ...apps]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (output) rmSync(output, { force: true });
    if (locked) unlinkSync(lockPath);
  }
}
