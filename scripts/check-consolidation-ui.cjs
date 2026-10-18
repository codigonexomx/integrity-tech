// Local-only UI verification; temporary credentials never appear in artifacts.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium, expect } = require('../integrity-tech-frontend/node_modules/@playwright/test');
const folder = 'output/consolidation-consistency';
const credentialsPath = '/private/tmp/integrity-consolidation-ui.json';
(async()=>{
  const credentials=JSON.parse(fs.readFileSync(credentialsPath,'utf8'));
  const source=JSON.parse(fs.readFileSync(folder+'/source-snapshot.json','utf8'));
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  const checks=[];
  try {
    await page.goto('https://localhost:8443/staff/login');
    await page.locator('#staff-email').fill(credentials.email);
    await page.locator('#staff-password').fill(credentials.password);
    await page.getByPlaceholder('slug opcional').fill(credentials.organizationSlug);
    await page.getByRole('button',{name:'Entrar al panel'}).click();
    await page.waitForURL('**/recruiter/dashboard');
    await expect(page.locator('article')).toHaveCount(8);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'DEMO 07',exact:true})});
    await expect(card).toContainText('Pendiente de revisión');
    await expect(card).toContainText('Puntuación: Pendiente');
    await page.screenshot({path:folder+'/listado-corregido.png',fullPage:true});
    for(const r of source.reports) {
      await page.goto('https://localhost:8443/recruiter/attempts/'+r.attemptId);
      await expect(page.getByRole('heading',{name:r.candidateName,exact:true})).toBeVisible();
      await expect(page.getByText(r.overallScore,{exact:true})).toBeVisible();
      if(r.candidateName==='DEMO 07') {
        assert.equal(r.overallScore,'Pendiente de revisión');
        await expect(page.getByText('Pendiente de entrega',{exact:true})).toHaveCount(0);
        await page.screenshot({path:folder+'/reporte-pendiente-corregido.png',fullPage:true});
      }
      if(r.candidateName==='DEMO 03') await page.screenshot({path:folder+'/reporte-cero-verificado.png',fullPage:true});
      checks.push({candidate:r.candidateName,visibleScore:r.overallScore,result:'PASS'});
    }
    await context.clearCookies();
    await page.evaluate(()=>localStorage.clear());
    fs.writeFileSync(folder+'/ui-verification.json',JSON.stringify({checkedAt:new Date(),dashboardCandidates:8,reportChecks:checks,pendingLabelMatches:true,externalMessagesSent:0},null,2));
    console.log('Listado y ocho reportes comprobados visualmente mediante navegador local.');
  } finally {
    await browser.close();
    fs.unlinkSync(credentialsPath);
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
