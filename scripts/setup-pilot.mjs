import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { root } from './pilot-common.mjs';
const { values } = parseArgs({ options: {
  domain: { type: 'string' }, 'admin-email': { type: 'string' },
  output: { type: 'string', default: resolve(root, '.env.pilot') },
} });
const remote = Boolean(values.domain);
if (remote && (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(values.domain) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values['admin-email'] || ''))) throw new Error('Para un servidor indica --domain y --admin-email válidos.');
const secret = () => randomBytes(32).toString('hex');
const domain = values.domain || 'localhost';
const contents = `# Privado. No versionar ni compartir. Custodiar secretos fuera del servidor.
PILOT_DOMAIN=${domain}
PILOT_ORIGIN=https://${domain}${remote ? '' : ':8443'}
PILOT_HTTP_PORT=${remote ? '80' : '8080'}
PILOT_HTTPS_PORT=${remote ? '443' : '8443'}
PILOT_BIND_IP=${remote ? '0.0.0.0' : '127.0.0.1'}
PILOT_ORGANIZATION=piloto
PILOT_ADMIN_EMAIL=${values['admin-email'] || 'admin@piloto.local'}
PILOT_ADMIN_PASSWORD=${secret()}
POSTGRES_PASSWORD=${secret()}
REDIS_PASSWORD=${secret()}
JWT_SECRET=${secret()}
ENCRYPTION_KEY=${secret()}
HMAC_SALT=${secret()}
PILOT_BACKUP_KEY=${secret()}
`;
const path = resolve(values.output); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(path, contents, { mode: 0o600, flag: 'wx' });
console.log('Entorno privado generado con permisos 0600, sin sobrescribir archivos ni iniciar servicios.');
