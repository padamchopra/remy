import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {chromiumPath} from './chromium.mjs';
const browser=await chromium.launch({executablePath:chromiumPath()});
try {
 for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:850},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();
  const org={id:'team',name:'Studio',role:'owner',personal:false};
  let connected=false, imported=false;
  await page.routeWebSocket(/\/api\//,()=>{});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const base='/api/organizations/team';
   if(path===`${base}/github/token`) {
    assert.deepEqual(route.request().postDataJSON(),{token:'test-pat'});connected=true;return route.fulfill({json:{connected:true}});
   }
   if(path===`${base}/github/accessible-repositories`) {
    assert.equal(connected,true);return route.fulfill({json:{repositories:[{id:1,name:'repo',full_name:'example/repo'}],nextPage:null}});
   }
   if(path===`${base}/github/import`) {
    assert.deepEqual(route.request().postDataJSON(),{fullName:'example/repo'});imported=true;return route.fulfill({json:{workspace:{id:'repo'}}});
   }
   const responses={
    '/api/runtime':{mode:'hub',auth:{}},'/api/profile':{id:'reader',name:'Reader'},'/api/personal':{personal:org},'/api/organizations':{organizations:[org]},
    [base+'/threads']:{threads:[],cursor:0},[base+'/computers']:{computers:[]},[base+'/members']:{members:[]},[base+'/teams']:{teams:[]},[base+'/workspaces']:{workspaces:[]},[base+'/notifications']:{notifications:[],devices:[]},
    [base+'/connections']:{canManage:true,providers:[{id:'github',configured:false,subjects:['member']}],connections:[]},
   };
   return route.fulfill({status:path in responses?200:404,json:responses[path]??{error:'Unexpected request'}});
  });
  await page.goto(`${process.env.WEBSITE_URL??'http://127.0.0.1:5187'}/app/#/workspaces?organization=team`);
  await page.getByRole('button',{name:'Add a workspace',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Use a personal access token'}).click();
  await dialog.getByLabel('Personal access token',{exact:true}).fill('test-pat');
  await dialog.locator('form').getByRole('button',{name:'Connect GitHub',exact:true}).click();
  await dialog.getByRole('button',{name:'example/repo',exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Find a repository').isVisible(),true);
  await dialog.getByLabel('Find a repository').fill('missing');
  assert.equal(await dialog.getByRole('button',{name:'example/repo',exact:true}).count(),0);
  await dialog.getByLabel('Find a repository').fill('example');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await dialog.getByRole('button',{name:'example/repo',exact:true}).click();
  await dialog.waitFor({state:'hidden'});assert.equal(imported,true);
  await page.getByRole('button',{name:'Add a workspace',exact:true}).click();
  await page.getByRole('button',{name:'Enter a repository URL'}).click();
  await page.getByLabel('Repository origin',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  console.log(`GitHub workspace picker passed: ${mobile?'phone':'desktop'}`);
  await context.close();
 }
} finally {await browser.close();}
