import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { root, readEnv, run, composeArgs } from './pilot-common.mjs';
const { values } = parseArgs({ options: { 'env-file': { type: 'string', default: resolve(root, '.env.pilot') }, project: { type: 'string' } } });
const all = readEnv(values['env-file']);
const env = Object.fromEntries(['PILOT_ORGANIZATION', 'PILOT_ADMIN_EMAIL', 'PILOT_ADMIN_PASSWORD'].map(k => [k, all[k]]));
const code = `let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',async()=>{const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();try{const result=await require('./dist/pilot/bootstrap').bootstrapPilot(p,JSON.parse(input));console.log(JSON.stringify(result));}catch{console.error('No se pudo inicializar el piloto. Revisa variables y migraciones.');process.exitCode=1;}finally{await p.$disconnect();}});`;
const result = run('docker', [...composeArgs(values['env-file'], values.project), 'exec', '-T', 'backend', 'node', '-e', code], { input: JSON.stringify(env) });
process.stdout.write(result);
