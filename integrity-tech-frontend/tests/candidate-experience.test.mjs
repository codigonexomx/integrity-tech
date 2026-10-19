import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const values = new Map();
const module = { exports: {} };
const source = readFileSync(new URL('../src/services/candidate-experience.ts',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,{module,exports:module.exports,localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null}});
const {reconcileCandidateAnswers,rememberCandidateInvitation,resumableCandidateAttempt,candidateErrorMessage,saveCandidateAnswer,readCandidateAnswers}=module.exports;
test('a stale server snapshot cannot erase a same-attempt local answer whose queue just drained',()=>{
 const result=reconcileCandidateAnswers('attempt',{q1:{value:1}},{attemptId:'attempt',answers:{q1:{value:1},q2:{value:2}}},[],[]);
 assert.equal(result.q2.value,2);
});
test('another candidate cache is excluded and the newest pending selection wins',()=>{
 const result=reconcileCandidateAnswers('a',{q1:{value:1}},{attemptId:'b',answers:{private:{value:9}}},[{questionId:'q1',response:{value:2}}],[{questionId:'q1',response:{value:3}}]);
 assert.equal(result.private,undefined);assert.equal(result.q1.value,3);
});
test('an edited local selection wins over an older queued snapshot',()=>{
 const result=reconcileCandidateAnswers('a',{}, {attemptId:'a',answers:{q:{value:3}}},[{questionId:'q',response:{value:2}}],[]);
 assert.equal(result.q.value,3);
});
test('resuming requires the invitation mapping AND the candidate session in this browser',()=>{
 const id='00000000-0000-7000-8000-000000000001';
 rememberCandidateInvitation(' it-123456 ',id);
 assert.equal(resumableCandidateAttempt('IT-123456'),null);
 values.set(`candidate-token:${id}`,'fictitious-session');
 assert.equal(resumableCandidateAttempt('IT-123456'),id);
 assert.equal(resumableCandidateAttempt('IT-654321'),null);
});
test('candidate error screens never disclose technical authorization or server payloads',()=>{
 assert.match(candidateErrorMessage({status:401,message:'Missing authorization header'}),/sesión/);
 assert.match(candidateErrorMessage({status:503,message:'internal database details'}),/Reintentar/);
 assert.doesNotMatch(candidateErrorMessage({status:503,message:'internal database details'}),/database/);
});

test('a synchronous same-attempt copy survives navigation before an IndexedDB write can finish',()=>{
 saveCandidateAnswer('fresh-attempt','q1',{selectedOptionId:'b'});
 assert.equal(readCandidateAnswers('fresh-attempt').q1.selectedOptionId,'b');
 assert.equal(readCandidateAnswers('another-attempt').q1,undefined);
});
