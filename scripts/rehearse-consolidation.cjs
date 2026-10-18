// Run inside the local pilot backend with: node - <phase> < this-file
// Creates only a dedicated QA organization and @example.test candidates.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { PasswordService } = require('./dist/modules/iam/services/password.service');
const p = new PrismaClient();
const statePath = '/tmp/integrity-consolidation-rehearsal.json';
const phase = process.argv[2];
const start = new Date();
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function api(path, body, token) {
  const r = await fetch('http://127.0.0.1:3001/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : {'content-type':'application/json'}), ...(token ? {authorization:'Bearer '+token} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(`${path}: ${r.status} ${data.message}`);
  return data;
}
function load() {
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.match(s.slug, /^qa-consolidado-\d+$/);
  return s;
}
async function cleanup(s) {
  const users = await p.user.findMany({where:{organizationId:s.organizationId},select:{id:true}});
  await p.userSession.updateMany({where:{userId:{in:users.map(u=>u.id)},revokedAt:null},data:{revokedAt:new Date()}});
  await p.user.updateMany({where:{organizationId:s.organizationId},data:{isActive:false}});
  // Pending invitation access is closed as well; snapshot stays tied to its earlier cut.
  await p.candidateInvitation.updateMany({where:{organizationId:s.organizationId,status:'PENDING'},data:{expiresAt:new Date(Date.now()-1000)}});
  const active = await p.user.count({where:{organizationId:s.organizationId,isActive:true}});
  const sessions = await p.userSession.count({where:{userId:{in:users.map(u=>u.id)},revokedAt:null}});
  assert.equal(active,0); assert.equal(sessions,0);
  fs.unlinkSync(statePath);
  return {organizationId:s.organizationId, activeUsers:active, activeSessions:sessions, credentialsRemoved:true, pendingInvitationsExpired:true};
}
async function main() {
  if (phase === 'seed') {
    assert.ok(!fs.existsSync(statePath), 'Cleanup previous rehearsal first');
    const slug = 'qa-consolidado-'+Date.now();
    const password = crypto.randomBytes(24).toString('base64url');
    const org = await p.organization.create({data:{slug,name:'Ensayo ficticio tabla consolidada'}});
    const user = await p.user.create({data:{organizationId:org.id,email:'reclutador-'+slug+'@example.test',passwordHash:new PasswordService().hashPassword(password),firstName:'Reclutador',lastName:'Ensayo'}});
    const state = {slug,organizationId:org.id,staffId:user.id,password,email:user.email,rows:[]};
    fs.writeFileSync(statePath,JSON.stringify(state),{mode:0o600});
    const role = await p.role.upsert({where:{name:'qa_consolidation_recruiter'},update:{},create:{name:'qa_consolidation_recruiter'}});
    for (const code of ['invitations.create','invitations.read','attempts.read','reports.read']) {
      const permission = await p.permission.findUniqueOrThrow({where:{code}});
      await p.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},update:{},create:{roleId:role.id,permissionId:permission.id}});
    }
    await p.userRole.create({data:{userId:user.id,roleId:role.id}});
    const assessment = await p.assessment.create({data:{organizationId:org.id,code:'ENSAYO_CONSOLIDADO',name:'Cuestionario ficticio consolidado diez preguntas',status:'PUBLISHED',createdByUserId:user.id}});
    const blueprint = {purpose:'Ensayo técnico ficticio del consolidado. No mide aptitud.',validationStatus:'PRACTICE_ONLY'};
    const version = await p.assessmentVersion.create({data:{assessmentId:assessment.id,organizationId:org.id,version:'1.0.0',status:'PUBLISHED',title:assessment.name,blueprintJson:blueprint,contentHash:hash(blueprint),publishedAt:new Date(),createdByUserId:user.id,approvedByUserId:user.id}});
    for (let i=0;i<10;i++) {
      const item = await p.item.create({data:{organizationId:org.id,itemCode:'ENSAYO_'+i,status:'ACTIVE',createdByUserId:user.id}});
      const stemJson = {type:'MULTIPLE_CHOICE',defaultPoints:1,content:{text:`Práctica ficticia ${i+1}: ¿cuánto es ${i+1} más 1?`,options:[{id:'a',text:String(i+2)},{id:'b',text:String(i+5)}],dimension:'PRACTICA'}};
      const scoringKeyJson = {correctOptionId:'a'};
      const iv = await p.itemVersion.create({data:{itemId:item.id,version:'1.0.0',status:'PUBLISHED',stemJson,scoringKeyJson,contentHash:hash({stemJson,scoringKeyJson}),publishedAt:new Date(),createdByUserId:user.id,approvedByUserId:user.id}});
      await p.assessmentVersionItem.create({data:{assessmentVersionId:version.id,itemVersionId:iv.id,sortOrder:i,weight:1,role:'SCORED'}});
    }
    await p.exam.create({data:{id:assessment.id,organizationId:org.id,title:assessment.name,description:blueprint.purpose,durationMinutes:15,isPublished:true,createdBy:user.id}});
    Object.assign(state,{examId:assessment.id,versionId:version.id});
    fs.writeFileSync(statePath,JSON.stringify(state));
    const staff = await api('/auth/login',{email:user.email,password,organizationSlug:slug});
    const scores = [8,6,0,10,7];
    for (let i=1;i<=10;i++) {
      const name='DEMO '+String(i).padStart(2,'0');
      const email='candidato-'+i+'-'+slug+'@example.test';
      const inv = await api('/evaluations/invitations',{candidateName:name,email,examId:assessment.id},staff.accessToken);
      const ir = await p.candidateInvitation.findFirstOrThrow({where:{organizationId:org.id,email},select:{id:true}});
      const row={candidate:name,email,invitationId:ir.id,expectedScore:i<=5?scores[i-1]:null,expectedState:['','','','','','','En curso','Pendiente de revisión','Tiempo terminado · incompleto','Invitación pendiente sin inicio','Invitación vencida sin inicio'][i]||'Completado'};
      if(i<=8) {
        const c=await api('/evaluations/invitations/claim',{accessCode:inv.accessCode,candidateName:name,email});
        row.attemptId=c.attemptId;
        await api('/evaluations/attempts/'+c.attemptId+'/consent',{consentVersion:'pilot-consent-v1'},c.token);
        const session=await api('/evaluations/attempts/'+c.attemptId+'/session',undefined,c.token);
        assert.equal(session.questions.length,10);
        if(i<=5 || i===7) {
          for(const [qi,q] of session.questions.entries()) {
            await api('/evaluations/attempts/'+c.attemptId+'/submit',{questionId:q.id,itemVersionId:q.itemVersionId,response:{selectedOptionId:qi<(scores[i-1]??5)?'a':'b'}},c.token);
          }
          if(i<=5) assert.equal((await api('/evaluations/attempts/'+c.attemptId+'/finalize',{},c.token)).status,'COMPLETED');
          else await p.examAttempt.update({where:{id:c.attemptId},data:{status:'SUBMITTED',submittedAt:new Date()}});
        }
        if(i===8) {
          await p.examAttempt.update({where:{id:c.attemptId},data:{startedAt:new Date(Date.now()-16*60000)}});
          assert.equal((await api('/evaluations/attempts/'+c.attemptId+'/session',undefined,c.token)).status,'EXPIRED');
        }
      } else if(i===10) {
        await p.candidateInvitation.update({where:{id:ir.id},data:{expiresAt:new Date(Date.now()-1000)}});
      }
      state.rows.push(row); fs.writeFileSync(statePath,JSON.stringify(state));
    }
    await api('/auth/logout',{refreshToken:staff.refreshToken},staff.accessToken);
    return {phase,start,end:new Date(),elapsedSeconds:(Date.now()-start.getTime())/1000,organizationId:org.id,examId:assessment.id,versionId:version.id,questionCount:10,maximum:10,expected:state.rows,fixtureOverrides:['DEMO 07 status SUBMITTED','DEMO 08 startedAt in past','DEMO 10 invitation expiresAt in past']};
  }
  const s=load();
  if(phase==='cleanup') {
    const result = await cleanup(s);
    return {phase,start,end:new Date(),...result};
  }
  // Only redirect this phase to a mode-0600 temporary file, never a shared artifact.
  if(phase==='ui-credentials') return {email:s.email,password:s.password,organizationSlug:s.slug};
  assert.equal(phase,'snapshot');
  const staff=await api('/auth/login',{email:s.email,password:s.password,organizationSlug:s.slug});
  try {
    const cut=new Date();
    const dashboard=await api('/evaluations/attempts',undefined,staff.accessToken);
    const reports=[];
    for(const r of s.rows.filter(r=>r.attemptId)) {
      const full=await api('/evaluations/attempts/'+r.attemptId,undefined,staff.accessToken);
      reports.push({attemptId:r.attemptId,candidateName:full.candidateName,email:full.email,overallScore:full.overallScore,date:full.date,retired:full.integrityProfile?.usable===false});
    }
    const invitations=await p.candidateInvitation.findMany({where:{organizationId:s.organizationId,examId:s.examId},select:{id:true,candidateName:true,email:true,status:true,expiresAt:true,attemptId:true}});
    const attempts=await p.examAttempt.findMany({where:{organizationId:s.organizationId,examId:s.examId},select:{id:true,userId:true,organizationId:true,examId:true,assessmentVersionId:true,status:true,startedAt:true,score:true,submissions:{select:{itemVersionId:true,isCorrect:true,pointsEarned:true}}}});
    const links=await p.assessmentVersionItem.findMany({where:{assessmentVersionId:s.versionId},select:{itemVersionId:true,itemVersion:{select:{stemJson:true,scoringKeyJson:true}}}});
    return {phase,start,end:new Date(),elapsedSeconds:(Date.now()-start.getTime())/1000,cut,organizationId:s.organizationId,examId:s.examId,versionId:s.versionId,dashboard,reports,invitations,attempts,links};
  } finally { await api('/auth/logout',{refreshToken:staff.refreshToken},staff.accessToken); }
}
main().then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
