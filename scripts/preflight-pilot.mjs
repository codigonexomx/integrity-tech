import { statSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { root, readEnv, composeArgs, run } from './pilot-common.mjs';
const { values } = parseArgs({ options: {
  'env-file': { type: 'string', default: resolve(root, '.env.pilot') },
  remote: { type: 'boolean', default: false },
} });
const checks = [];
const check = (name, ok) => checks.push({ name, pass: Boolean(ok) });
check('Node 22 o superior', +process.versions.node.split('.')[0] >= 22);
if (!existsSync(values['env-file'])) {
  check('Archivo de entorno privado existente', false);
} else {
  const config = readEnv(values['env-file']);
  check('Entorno sin permisos de grupo u otros', (statSync(values['env-file']).mode & 0o077) === 0);
  const keys = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY', 'HMAC_SALT', 'PILOT_BACKUP_KEY', 'PILOT_ADMIN_PASSWORD'];
  check('Secretos aleatorios de 32 bytes en hexadecimal', keys.every(k => /^[a-f\d]{64}$/i.test(config[k] || '')));
  check('Secretos distintos para cada finalidad', new Set(keys.map(k => config[k])).size === keys.length);
  check('Organización y correo de administración definidos', /^[a-z0-9-]+$/.test(config.PILOT_ORGANIZATION || '') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.PILOT_ADMIN_EMAIL || ''));
  let origin;
  try { origin = new URL(config.PILOT_ORIGIN); } catch { /* reported below */ }
  check('Origen HTTPS coherente con dominio sin rutas ni credenciales', origin?.protocol === 'https:' && origin?.hostname === config.PILOT_DOMAIN && origin?.pathname === '/' && !origin?.username && !origin?.password && !origin?.search && !origin?.hash);
  if (values.remote) {
    check('Dominio remoto y correo no ficticios', /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(config.PILOT_DOMAIN || '') && !/\.(local|test|invalid)$/.test(config.PILOT_DOMAIN) && !/\.(local|test|invalid)$/.test(config.PILOT_ADMIN_EMAIL));
    check('Puertos públicos HTTPS y HTTP estándar', config.PILOT_HTTP_PORT === '80' && config.PILOT_HTTPS_PORT === '443' && origin?.port === '');
    check('Gateway configurado para escuchar en el servidor', config.PILOT_BIND_IP === '0.0.0.0');
  } else check('Piloto de preparación restringido a loopback', config.PILOT_BIND_IP === '127.0.0.1');
  try { run('docker', [...composeArgs(values['env-file']), 'config', '--quiet']); check('Compose válido sin mostrar secretos', true); }
  catch { check('Compose válido sin mostrar secretos', false); }
}
console.log(JSON.stringify({ mode: values.remote ? 'remote_configuration_only' : 'local', checks, ready: checks.every(x => x.pass), pending: ['Verificación DNS, certificado y acceso externo en el servidor definitivo', 'Condiciones de datos y responsables aprobados', 'Recuperación y respaldo externo comprobados en ese servidor'] }, null, 2));
if (checks.some(x => !x.pass)) process.exitCode = 1;
