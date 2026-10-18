import { readFileSync, openSync, readSync, closeSync, fstatSync, createReadStream, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function readEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
    const at = line.indexOf('=');
    if (at < 1) throw new Error('Línea de entorno inválida.');
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    return [key, value];
  }));
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180_000, maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const phases = String(result.stderr || '').match(/restore-phase: [a-z-]+/g) || [];
    throw new Error(`Falló ${command} (${args[0] || ''})${phases.length ? `; ${phases.at(-1)}` : ''}; revisa el servicio y sus permisos. No se imprimen secretos ni salidas de contenedores.`);
  }
  return result.stdout;
}
export function composeArgs(envFile, project) {
  if (project && !/^[a-z0-9][a-z0-9_-]{1,60}$/.test(project)) throw new Error('Nombre de proyecto inválido.');
  return ['compose', ...(project ? ['-p', project] : []), '--env-file', resolve(envFile), '-f', join(root, 'docker-compose.pilot.yml')];
}
export function backupKey(config) {
  const key = process.env.PILOT_BACKUP_KEY || config.PILOT_BACKUP_KEY;
  if (!/^[a-f\d]{64}$/i.test(key || '')) throw new Error('Se necesita PILOT_BACKUP_KEY de 32 bytes hexadecimales, custodiada por separado.');
  return Buffer.from(key, 'hex');
}
export async function decryptBackup(input, destination, key) {
  const fd = openSync(input, 'r');
  let size, header, tag;
  try {
    size = fstatSync(fd).size;
    if (size < 33) throw new Error('Respaldo demasiado corto.');
    header = Buffer.alloc(16); tag = Buffer.alloc(16);
    readSync(fd, header, 0, 16, 0); readSync(fd, tag, 0, 16, size - 16);
  } finally { closeSync(fd); }
  if (header.subarray(0, 4).toString() !== 'ITP1') throw new Error('Formato de respaldo desconocido.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(4));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  await pipeline(createReadStream(input, { start: 16, end: size - 17 }), decipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  const entries = run('tar', ['-tzf', destination]).toString().trim().split('\n').sort();
  if (JSON.stringify(entries) !== JSON.stringify(['database.sql', 'private-files.tar', 'redis.tar.gz'])) throw new Error('El respaldo no contiene exactamente los tres componentes esperados.');
  if (run('tar', ['-tvzf', destination]).toString().trim().split('\n').some(line => line[0] !== '-')) throw new Error('Los componentes del respaldo deben ser archivos regulares.');
}
