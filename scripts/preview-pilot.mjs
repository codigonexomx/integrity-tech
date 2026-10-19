// Screen-sharing demo only. Never publish this HTTP loopback preview.
import http from 'node:http';
import https from 'node:https';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run, readEnv, composeArgs } from './pilot-common.mjs';

const config = readEnv(join(root, '.env.pilot'));
if (config.PILOT_DOMAIN !== 'localhost' || config.PILOT_BIND_IP !== '127.0.0.1') throw new Error('La vista previa solo admite el piloto local enlazado a 127.0.0.1.');
const port = 8765;
const origin = `http://127.0.0.1:${port}`;
const upstreamPort = Number(config.PILOT_HTTPS_PORT || 8443);
const pilotOrigin = config.PILOT_ORIGIN || `https://localhost:${upstreamPort}`;
const temporary = mkdtempSync(join(tmpdir(), 'integrity-preview-'));
const certificate = join(temporary, 'ca.crt');
try {
  run('docker', [...composeArgs(join(root, '.env.pilot')), 'cp', 'gateway:/data/caddy/pki/authorities/local/root.crt', certificate]);
} catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
const ca = readFileSync(certificate);
const server = http.createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin)) {
    response.writeHead(403); response.end('Origen no permitido.'); return;
  }
  const headers = { ...request.headers, host: `localhost:${upstreamPort}` };
  if (headers.origin) headers.origin = pilotOrigin;
  const upstream = https.request({ hostname: 'localhost', port: upstreamPort, path: request.url, method: request.method, headers, ca }, result => {
    const outgoing = { ...result.headers };
    if (outgoing['access-control-allow-origin'] === pilotOrigin) outgoing['access-control-allow-origin'] = origin;
    response.writeHead(result.statusCode || 502, outgoing); result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('La demo local no está disponible. Comprueba sus contenedores.'); });
  request.pipe(upstream);
});
server.on('error', () => { rmSync(temporary, { recursive: true, force: true }); console.error('No se pudo abrir la vista previa local; comprueba si el puerto 8765 ya está ocupado.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Demo solo en este equipo: ${origin}/exam/login. TLS del piloto verificado. Ctrl+C para cerrar.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { rmSync(temporary, { recursive: true, force: true }); process.exit(0); }));
