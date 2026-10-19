// Regression checks against a running local pilot. Creates only fictitious QA candidates.
import fs from 'node:fs';
import https from 'node:https';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const credentials = JSON.parse(fs.readFileSync(process.env.PILOT_QA_RECRUITER_FILE || '/private/tmp/integrity-qa-recruiter.json', 'utf8'));
const ca = fs.readFileSync(process.env.PILOT_QA_CA || '/private/tmp/integrity-pilot-ca.crt');
const origin = new URL(process.env.PILOT_QA_ORIGIN || 'https://localhost:8443');
const output = 'output/pilot-qa-fixed'; fs.mkdirSync(output, { recursive: true });
const results = [];
async function request(path, data, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: origin.hostname, port: origin.port, path: '/api' + path, method: data === undefined ? 'GET' : 'POST', ca,
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => {
        let json; try { json = JSON.parse(body); } catch { json = {}; }
        resolve({ status: res.statusCode, body: json, cacheControl: res.headers['cache-control'] });
      });
    }); req.on('error', reject); if (data !== undefined) req.write(JSON.stringify(data)); req.end();
  });
}
async function ok(path, data, token) {
  const r = await request(path, data, token); assert.ok(r.status < 300, `${path}: ${r.status} ${JSON.stringify(r.body.message)}`); return r.body;
}
function fixture(operation, attemptId) {
  const code = `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{try{const{operation,id}=JSON.parse(s);if(operation==='expire'){await p.examAttempt.update({where:{id},data:{startedAt:new Date(Date.now()-16*60000)}})}else{const{AnswersQueueProcessor}=require('./dist/modules/evaluations/services/answers-queue.processor');await new AnswersQueueProcessor(p,{},{}).handleSaveAnswer({data:{attemptId:id,questionId:'ignored',response:{selectedOptionId:'wrong'},submittedAt:new Date().toISOString()}})}console.log('fixture verified')}catch(e){console.error(e.message);process.exitCode=1}finally{await p.$disconnect()}})`;
  const r = spawnSync('docker', ['compose', '--env-file', '.env.pilot', '-f', 'docker-compose.pilot.yml', 'exec', '-T', 'backend', 'node', '-e', code], { input: JSON.stringify({ operation, id: attemptId }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}
const staff = await ok('/auth/login', credentials);
const token = staff.accessToken;
for (const path of ['/admin/users', '/audit/events', '/psychometric-governance/items']) assert.equal((await request(path, undefined, token)).status, 403);
results.push({ check: 'restricted staff permissions', result: 'PASS' });
const exam = (await ok('/exams', undefined, token)).find(e => e.title.includes('Práctica'));
assert.ok(exam);
async function candidate(label) {
  const email = `qa-${label}-${Date.now()}@example.test`;
  const invitation = await ok('/evaluations/invitations', { candidateName: `QA ${label}`, email, examId: exam.id }, token);
  const c = await ok('/evaluations/invitations/claim', { accessCode: invitation.accessCode, candidateName: `QA ${label}`, email });
  const base = '/evaluations/attempts/' + c.attemptId;
  await ok(base + '/consent', { consentVersion: 'pilot-consent-v1' }, c.token);
  const session = await ok(base + '/session', undefined, c.token);
  const answer = (q, correct = true) => request(base + '/submit', { questionId: q.id, itemVersionId: q.itemVersionId, response: { selectedOptionId: correct ? q.content.text.includes('3 cajas') ? 'b' : q.content.text.includes('revisar un dato') ? 'a' : 'c' : q.content.text.includes('revisar un dato') ? 'b' : 'a' } }, c.token);
  return { ...c, base, session, answer };
}
const normal = await candidate('normal');
for (const q of normal.session.questions) assert.equal((await normal.answer(q)).status, 202);
const before = await ok(normal.base + '/session', undefined, normal.token);
assert.equal(Object.keys(before.answers).length, 3); assert.equal(before.deadlineAt, normal.session.deadlineAt);
assert.equal((await ok(normal.base + '/consent', undefined, normal.token)).accepted, true);
assert.equal((await ok(normal.base + '/finalize', {}, normal.token)).status, 'COMPLETED');
const report = await ok(normal.base, undefined, token);
assert.match(report.overallScore, /^3 puntos/);
assert.equal((await normal.answer(normal.session.questions[0], false)).status, 409);
fixture('legacy', normal.attemptId);
assert.equal((await ok(normal.base + '/finalize', {}, normal.token)).status, 'COMPLETED');
const after = await ok(normal.base, undefined, token);
assert.equal(after.overallScore, report.overallScore); assert.equal(after.date, report.date);
assert.equal((await ok(normal.base + '/session', undefined, normal.token)).status, 'COMPLETED');
assert.match((await request(normal.base + '/session', undefined, normal.token)).cacheControl, /no-store/);
results.push({ check: 'restore, stable deadline, completed answer rejection, legacy queue and idempotent delivery', result: 'PASS', attemptId: normal.attemptId });
const omitted = await candidate('omitted');
assert.equal((await request(omitted.base + '/submit', { questionId: omitted.session.questions[0].id, response: {} }, omitted.token)).status, 400);
for (const q of omitted.session.questions.slice(0, 2)) assert.equal((await omitted.answer(q)).status, 202);
assert.equal((await request(omitted.base + '/finalize', {}, omitted.token)).status, 409);
assert.equal((await ok(omitted.base + '/session', undefined, omitted.token)).status, 'IN_PROGRESS');
assert.equal((await omitted.answer(omitted.session.questions[2])).status, 202);
assert.equal((await ok(omitted.base + '/finalize', {}, omitted.token)).status, 'COMPLETED');
results.push({ check: 'omitted question remains recoverable and completes after answering', result: 'PASS', attemptId: omitted.attemptId });
const zero = await candidate('zero');
for (const q of zero.session.questions) assert.equal((await zero.answer(q, false)).status, 202);
await ok(zero.base + '/finalize', {}, zero.token);
assert.match((await ok(zero.base, undefined, token)).overallScore, /^0 puntos/);
const listed = await ok('/evaluations/attempts', undefined, token);
assert.equal(listed.find(a => a.id === normal.attemptId).overallScore, '3 puntos');
assert.equal(listed.find(a => a.id === zero.attemptId).overallScore, '0 puntos');
assert.equal(listed.find(a => a.id === normal.attemptId).riskStatus, 'NOT_MONITORED');
results.push({ check: 'zero and full score have matching units in dashboard and report', result: 'PASS', attemptId: zero.attemptId });
const race = await candidate('race');
for (const q of race.session.questions) assert.equal((await race.answer(q)).status, 202);
const responses = await Promise.all([race.answer(race.session.questions[0], false), request(race.base + '/finalize', {}, race.token)]);
assert.equal(responses[1].body.status, 'COMPLETED');
const raceReport = await ok(race.base, undefined, token);
assert.match(raceReport.overallScore, responses[0].status === 202 ? /^2 puntos/ : /^3 puntos/);
assert.equal((await race.answer(race.session.questions[1], false)).status, 409);
assert.equal((await ok(race.base, undefined, token)).overallScore, raceReport.overallScore);
results.push({ check: 'simultaneous answer/finalization serializes without post-delivery score mutation', result: 'PASS', attemptId: race.attemptId });
const expired = await candidate('expired'); fixture('expire', expired.attemptId);
assert.equal((await expired.answer(expired.session.questions[0])).status, 409);
assert.equal((await ok(expired.base + '/session', undefined, expired.token)).status, 'EXPIRED');
assert.equal((await ok(expired.base + '/finalize', {}, expired.token)).status, 'EXPIRED');
assert.match((await ok(expired.base, undefined, token)).overallScore, /Sin puntuación/);
results.push({ check: 'server deadline rejects late answers and expires incomplete attempt without score', result: 'PASS', attemptId: expired.attemptId });
assert.equal((await request('/auth/logout', { refreshToken: staff.refreshToken }, token)).status, 201);
assert.equal((await request('/evaluations/attempts', undefined, token)).status, 401);
results.push({ check: 'logout revokes access', result: 'PASS' });
fs.writeFileSync(output + '/api-regression.json', JSON.stringify({ checkedAt: new Date(), results }, null, 2));
console.log(`${results.length} comprobaciones de regresión aprobadas. Sin credenciales en el informe.`);
