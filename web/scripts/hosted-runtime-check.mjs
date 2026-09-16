import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const url = new URL("/app/", process.env.WEBSITE_URL || "http://127.0.0.1:5180");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : chromium.executablePath()) });
const artifacts = process.env.QA_ARTIFACTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const personal = { id: "personal", name: "Personal", personal: true, role: "owner" };
const team = { id: "team", name: "Studio", personal: false, role: "owner" };
try {
  for (const returning of [false, true]) {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 850 }, isMobile: mobile, hasTouch: mobile });
      if (returning) await context.addInitScript(() => localStorage.setItem("remy.warm-cache", JSON.stringify({
        version: 1, at: Date.now(),
        servers: [{ id: "local", name: "Build Mac", url: "/api", local: true, online: true }],
        chats: [], dms: [], workspaces: [], agents: [], projects: [], details: [],
      })));
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [], unexpected = [], requests = [];
      let available = true;
      const modelEntries=["anthropic","openai","router","openrouter"].map(id=>({id,enabled:false,configured:false,models:[]}));
      const savedKeys=new Map();
      const favorites = new Set();
      const profile={id:"reader",name:"Reader",image:null}; let permissionMode="default";
      let lastMessage;
      let threadInput;
      let startCalls=0, messageCalls=0, releaseStart;
      const heldStart=new Promise(resolve=>{releaseStart=resolve;});
      const startIds=[], messageIds=[];
      let startedThread;
      let hasWorkspace=false;
      let preference=null;
      let failToggle=false;
      let failPreference=false;
      let connected = false;
      let sharedComputer = false;
      let sharedCloud = false;
      let cloudEnabled = false;
      let online = false;
      let releaseColdReads;
      let holdColdReads = true;
      const coldReads = new Promise(resolve => { releaseColdReads = resolve; });
      let releaseWorkspaces, releaseComputers;
      let holdSetupReads = true;
      const workspaceRead = new Promise(resolve => { releaseWorkspaces = resolve; });
      const computerRead = new Promise(resolve => { releaseComputers = resolve; });
      let remyDefault=null, workspaceDefault=null; const computerDefaults=new Map();
      const connections = new Set();
      const enabledProviders = new Set();
      const computerName = returning ? "Studio-Mac-with-a-long-unbroken-name-for-release-and-preview-builds" : "Studio Mac";
      page.on("pageerror", error => errors.push(error.message));
      let disconnectLive = false;
      const liveSockets = [];
      await page.routeWebSocket(/\/api\//, socket => { liveSockets.push(socket); if (disconnectLive) socket.close(); });
      await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        if (holdColdReads && ["/api/personal", "/api/organizations/team/threads"].includes(path)) await coldReads;
        if (holdSetupReads && path === "/api/organizations/team/workspaces") await workspaceRead;
        if (holdSetupReads && path === "/api/organizations/team/computers") await computerRead;
        if(path === "/api/profile") {
          if(route.request().method() === "PATCH") Object.assign(profile,route.request().postDataJSON());
          return route.fulfill({json:profile});
        }
        const org = path.startsWith("/api/organizations/team") ? team : personal;
        const base = `/api/organizations/${org.id}`;
        if(path === `${base}/profile-preferences`) {
          if(route.request().method() === "PATCH") permissionMode=route.request().postDataJSON().permissionMode;
          return route.fulfill({json:{permissionMode}});
        }
        if(path === `${base}/github/profile`) return route.fulfill({json:{image:"https://avatars.githubusercontent.com/u/1"}});
        if(path === `${base}/compute-shares/computers/personal-mac` && ["PUT","DELETE"].includes(route.request().method())) {sharedComputer=route.request().method()==="PUT";return route.fulfill({json:{ok:true}});}
        if(path === `${base}/compute-shares/cloud/modal` && ["PUT","DELETE"].includes(route.request().method())) {sharedCloud=route.request().method()==="PUT";return route.fulfill({json:{ok:true}});}
        if (path === `${base}/cloud-connection` && ["PUT", "PATCH"].includes(route.request().method())) {
          const connection = route.request().postDataJSON();
          if (route.request().method() === "PATCH") {
            if(failToggle){await new Promise(resolve=>setTimeout(resolve,700));return route.fulfill({status:502,json:{error:"Connection could not be saved."}});}
            if (connection.enabled) enabledProviders.add(connection.provider); else enabledProviders.delete(connection.provider);
            return route.fulfill({ json: { saved: true } });
          }
          assert.ok(connection.provider === "modal" ? connection.tokenId && connection.tokenSecret : connection.token);
          connections.add(connection.provider);
          if (connection.enabled) enabledProviders.add(connection.provider);
          return route.fulfill({ json: { saved: true } });
        }
        if(path === `${base}/model-defaults`) {
          const workspace=new URL(route.request().url()).searchParams.get("workspace");
          const computer=new URL(route.request().url()).searchParams.get("computer");
          if(route.request().method()==="PATCH") {if(computer)computerDefaults.set(computer,route.request().postDataJSON().choice);else if(workspace)workspaceDefault=route.request().postDataJSON().choice;else remyDefault=route.request().postDataJSON().choice;for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"model-defaults.changed"}));}catch{}}
          return route.fulfill({json:{remy:remyDefault,workspace:workspace?workspaceDefault:null,computer:computerDefaults.get(computer)??null}});
        }
        if(path === `${base}/model-favorites`) {
          if(route.request().method()==="PATCH") { const {key,enabled}=route.request().postDataJSON(); if(enabled)favorites.add(key);else favorites.delete(key); }
          return route.fulfill({json:{favorites:[...favorites]}});
        }
        if(path === `${base}/routing/preference`){if(route.request().method()==="POST"){await new Promise(resolve=>setTimeout(resolve,500));if(failPreference)return route.fulfill({status:500,json:{error:"Internal server error"}});preference=route.request().postDataJSON().computerId;}return route.fulfill({json:{computerId:preference}});}
        if(path===`${base}/github/workspace-branches`) return route.fulfill({json:{branches:[{name:"main",current:true,checkout:null},{name:"feature/selected",current:false,checkout:null}]}});
        if(path===`${base}/hosted/repo/codex`)return route.fulfill({json:{phase:"disconnected"}});
        if(path===`${base}/threads` && route.request().method()==="POST") {
          threadInput=route.request().postDataJSON();
          if(process.env.QA_START_ONLY === "1") {
            startCalls++;startIds.push(threadInput.requestId);
            if(startCalls===1){await heldStart;return route.fulfill({status:409,json:{error:"Fly.io could not start. Retry to continue."}});}
            return route.fulfill({status:201,json:{id:"12345678-1234-1234-1234-123456789012",computerId:"sprite"}});
          }
          return route.fulfill({status:409,json:{error:"Preview request captured."}});
        }
        if(process.env.QA_START_ONLY === "1" && path.endsWith("/attachments")) return route.fulfill({status:201,json:{id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}});
        if(process.env.QA_START_ONLY === "1" && path.endsWith("/options")) {
          Object.assign(startedThread.detail,route.request().postDataJSON());
          for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"snapshot",cursor:2,thread:startedThread}));}catch{}
          return route.fulfill({json:startedThread});
        }
        if(process.env.QA_START_ONLY === "1" && path===`${base}/computers/sprite/threads/12345678-1234-1234-1234-123456789012/message`) {
          messageCalls++;const input=route.request().postDataJSON();lastMessage=input;messageIds.push(input.messageId);
          if(messageCalls===1)return route.fulfill({status:503,json:{error:"Connection interrupted. Retry to send."}});
          startedThread={id:"12345678-1234-1234-1234-123456789012",computerId:"sprite",revision:1,stale:false,observedAt:Date.now(),access:{organizationId:org.id,owner:{id:"reader",label:"Reader"},participants:[],visibility:"private"},detail:{id:"12345678-1234-1234-1234-123456789012",title:input.text,branch:"feature/working",state:"idle",provider:"codex",model:"remy:openrouter:openrouter/auto",permissionMode:"default",entries:[{id:input.messageId,kind:"user",text:input.text},{id:"answer",kind:"assistant",text:"A reply from the selected provider."}]}};
          for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"snapshot",cursor:1,thread:startedThread}));}catch{}
          return route.fulfill({json:{ok:true}});
        }
        if(path.startsWith(`${base}/model-access/`)) {
          const id=path.split("/").at(-1), patch=route.request().postDataJSON(), entry=modelEntries.find(p=>p.id===id);
          assert.equal(route.request().method(),"PATCH");
          entry.enabled=patch.enabled;
          if(patch.apiKey){savedKeys.set(id,patch.apiKey);entry.configured=true;entry.models=["test/model-a","test/model-b"];}
          return route.fulfill({json:{providers:modelEntries}});
        }
        const responses = {
          [`${base}/model-access`]: {providers:modelEntries},
          "/api/runtime": { mode: "hub", auth: { google: true } },
          "/api/profile": { id: "reader", name: "Reader" },
          "/api/personal": { personal },
          "/api/organizations": { organizations: [team] },
          [base]: { organization: org },
          [`${base}/threads`]: { threads: process.env.QA_SCOPE_ONLY === "1" ? [{id:`${org.id}-thread`,computerId:`${org.id}-computer`,revision:1,stale:false,observedAt:Date.now(),access:{organizationId:org.id,owner:{id:"reader",label:"Reader"},participants:[],visibility:"private"},detail:{id:`${org.id}-thread`,title:org.personal?"Personal thread":"Studio thread",state:"idle",provider:"codex",entries:[]}}] : startedThread?[startedThread]:[], cursor: 0, member: { id: "reader", role: "owner" } },
          [`${base}/computers`]: { computers: connected ? [{ computerId: "studio", name: computerName, icon: "laptop", ownership: "personal", availability: online ? "online" : "offline", access: { mode: "owner" }, canUse: online, canManage: false, capabilities: { workspaces: [] } }] : [] },
          [`${base}/computers/options`]: { role: "owner", members: [], teams: [] },
          [`${base}/hosted`]: { settings: { enabled: cloudEnabled, provider: "fly-sprites", region: "", cpu: 1, memoryMiB: 2048, maxComputers: 5, idleMinutes: 12 }, secretNames: [], connections: [...connections], enabledProviders: [...enabledProviders], available },
          [`${base}/members`]: {members:[{id:"reader-member",userId:"reader",name:profile.name,image:profile.image,role:"owner"},...Array.from({length:4},(_,i)=>({id:`m${i}`,userId:`p${i}`,name:`Person ${i}`,image:`data:image/png;base64,${readFileSync(new URL('../public/favicon.png',import.meta.url)).toString('base64')}`,role:"member"}))]},
          [`${base}/teams`]: {teams:[]},
          [`${base}/workspaces/repo`]: {id:"repo",name:"Example",origin:"github.com/example/repo",restricted:false},
          [`${base}/workspaces`]: { workspaces: hasWorkspace?[{id:"repo",name:"Example",origin:"https://github.com/example/repo"}]:[], canManage: true },
          [`${base}/notifications`]: { notifications: [], devices: [] },
          [`${base}/environments`]: { environments: [], assignments: [], workspaces: [] },
          [`${base}/board/tickets`]: {items:process.env.QA_SCOPE_ONLY === "1"?[{id:`${org.id}-ticket`,entity:"ticket",fields:{title:org.personal?"Personal ticket":"Studio ticket",status:"todo",number:1,keyPrefix:org.personal?"PER":"STD"},lastActor:{id:"reader",label:"Reader"},activity:[]}]:[]},
          [`${base}/agents`]: {agents:process.env.QA_SCOPE_ONLY === "1"?[{id:`${org.id}-agent`,entity:"agent",fields:{name:org.personal?"Personal agent":"Studio agent",role:"Builder",scope:"org"},lastActor:{id:"reader",label:"Reader"},activity:[]}]:[]},
          [`${base}/connections`]: {canManage:true,providers:[],connections:[]},
          [`${base}/routing`]: {rules:[],canEdit:true,enabledProviders:[]},
          [`${base}/compute-shares`]: {canManage:true,computers:[{id:"personal-mac",name:"Personal Mac",icon:"laptop",platform:"darwin",shared:sharedComputer,available:true,sharedBy:sharedComputer?"Reader":null}],cloudConnections:[{provider:"modal",shared:sharedCloud,available:true,sharedBy:sharedCloud?"Reader":null}]},
        };
        if (!(path in responses)) unexpected.push(path);
        return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? { error: "Not found" } });
      });
      if (process.env.QA_PROFILE_ONLY === "1" || process.env.QA_START_ONLY === "1" || process.env.QA_COMPUTER_ONLY === "1" || process.env.QA_BRANCH_ONLY === "1" || process.env.QA_DEFAULTS_ONLY === "1" || process.env.QA_COMPUTER_DEFAULTS_ONLY === "1" || process.env.QA_SCOPE_ONLY === "1") {
        holdColdReads=false;holdSetupReads=false;releaseColdReads();releaseWorkspaces();releaseComputers();
        hasWorkspace=true;cloudEnabled=true;connections.add("fly-sprites");connections.add("modal");enabledProviders.add("fly-sprites");enabledProviders.add("modal");
        if(process.env.QA_SCOPE_ONLY === "1") profile.image="preset:cobalt-cyclops";
        const target=new URL(url);target.hash="/threads?organization=personal";await page.goto(target.href);
        if(process.env.QA_SCOPE_ONLY === "1") {
          const all=new URL(url);all.hash="/threads?organization=all";await page.goto(all.href);
          const combinedThreads=page.getByRole("region",{name:"Threads",exact:true});
          await combinedThreads.getByText("Personal thread",{exact:true}).waitFor();
          await combinedThreads.getByText("Studio thread",{exact:true}).waitFor();
          assert.equal(await combinedThreads.getByRole("button",{name:"New thread",exact:true}).count(),1,"Threads has one primary action");
          assert.equal(await page.getByRole("heading",{name:"Personal",exact:true}).count(),0);
          assert.equal(await page.getByRole("heading",{name:"Studio",exact:true}).count(),0);
          if(artifacts)await page.screenshot({path:`${artifacts}/unified-threads-${mobile?'phone':'desktop'}.png`});
          await combinedThreads.getByRole("button",{name:"New thread",exact:true}).click();
          const ownerDialog=page.getByRole("dialog");
          await ownerDialog.getByRole("combobox",{name:"Account",exact:true}).click();
          await page.getByRole("option",{name:"Studio",exact:true}).click();
          await ownerDialog.getByRole("button",{name:"Choose account",exact:true}).click();
          await page.waitForURL(/organization=all.*owner=team/);
          await page.getByRole("button",{name:"Back to all",exact:true}).click();
          await combinedThreads.getByText("Personal thread",{exact:true}).waitFor();
          all.hash="/board?organization=all";await page.goto(all.href);
          await page.getByText("Personal ticket",{exact:false}).waitFor();
          await page.getByText("Studio ticket",{exact:false}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Create ticket",exact:true}).count(),1);
          assert.equal(await page.getByRole("region",{name:"Tasks",exact:true}).count(),1);
          if(artifacts)await page.screenshot({path:`${artifacts}/unified-tasks-${mobile?'phone':'desktop'}.png`});
          all.hash="/inbox?organization=all";await page.goto(all.href);
          await page.getByText("Personal agent",{exact:true}).waitFor();
          await page.getByText("Studio agent",{exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Create agent",exact:true}).count(),1);
          assert.equal(await page.getByRole("region",{name:"Inbox",exact:true}).count(),1);
          all.hash="/workspaces?organization=all";await page.goto(all.href);
          await page.getByText("Personal · https://github.com/example/repo",{exact:true}).waitFor();
          await page.getByText("Studio · https://github.com/example/repo",{exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Add workspace",exact:true}).count(),1);
          assert.equal(await page.getByRole("heading",{name:"Personal",exact:true}).count(),0);
          assert.equal(await page.getByRole("heading",{name:"Studio",exact:true}).count(),0);
          all.hash="/settings/general?organization=all";await page.goto(all.href);
          await page.getByRole("region",{name:"General settings",exact:true}).waitFor();
          assert.equal(await page.getByRole("region",{name:"General settings",exact:true}).count(),1);
          const defaults=page.getByRole("region",{name:"Account defaults",exact:true});
          await defaults.getByText("Personal default model",{exact:true}).waitFor();
          await defaults.getByText("Studio default model",{exact:true}).waitFor();
          assert.equal(await defaults.count(),1);
          all.hash="/settings/devices?organization=all";await page.goto(all.href);
          await page.getByRole("button",{name:"Manage computers",exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Manage computers",exact:true}).count(),1);
          assert.equal(await page.getByRole("heading",{name:"Personal",exact:true}).count(),0);
          assert.equal(await page.getByRole("heading",{name:"Studio",exact:true}).count(),0);
          all.hash="/settings/organization?organization=all&section=members&owner=team";await page.goto(all.href);
          const readerMember=page.locator('[data-slot="item"]',{hasText:"Reader"});
          await readerMember.locator('[data-slot="avatar-image"]').waitFor();
          assert.match(await readerMember.locator('[data-slot="avatar-image"]').getAttribute("src"),/cobalt-cyclops/);
          if(artifacts)await page.screenshot({path:`${artifacts}/member-avatar-${returning?'saved':'fresh'}-${mobile?'phone':'desktop'}.png`});
          all.hash="/settings/organization?organization=all&section=computers&owner=team";await page.goto(all.href);
          const computerShare=page.getByRole("switch",{name:"Share Personal Mac",exact:true});
          const cloudShare=page.getByRole("switch",{name:"Share Modal",exact:true});
          await computerShare.waitFor();await cloudShare.waitFor();
          await computerShare.click();await cloudShare.click();
          assert.equal(sharedComputer,true);assert.equal(sharedCloud,true);
          await page.reload();
          assert.equal(await page.getByRole("switch",{name:"Share Personal Mac",exact:true}).isChecked(),true);
          assert.equal(await page.getByRole("switch",{name:"Share Modal",exact:true}).isChecked(),true);
          assert.equal(await page.getByText("private-modal-secret",{exact:false}).count(),0);
          await page.getByText("Connection credentials stay private.",{exact:false}).waitFor();
          if(artifacts)await page.screenshot({path:`${artifacts}/organization-computers-${returning?'saved':'fresh'}-${mobile?'phone':'desktop'}.png`});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
          await context.close();console.log(`Unified account scope passed: ${returning?'saved local state':'fresh profile'}, ${mobile?'touch phone':'desktop'}.`);continue;
        }
        if(process.env.QA_PROFILE_ONLY === "1") {
          target.hash="/settings/general?organization=personal";await page.goto(target.href);
          await page.getByRole("button",{name:"Change",exact:true}).click();
          await page.getByRole("button",{name:"Cobalt cyclops",exact:true}).click();
          await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(profile.image,"preset:cobalt-cyclops");
          await page.reload();await page.getByRole("button",{name:"Change",exact:true}).click();
          assert.match(await page.getByRole("button",{name:"Cobalt cyclops",exact:true}).getAttribute("class"),/border-primary/);
          await page.getByRole("button",{name:"From GitHub",exact:true}).click();
          await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(profile.image,"https://avatars.githubusercontent.com/u/1");
          await page.getByRole("button",{name:"Change",exact:true}).click();
          const footerLayout = await page.getByRole("dialog").evaluate(dialog => {
            const box=dialog.getBoundingClientRect();
            const buttons=[...dialog.querySelectorAll('[data-slot="dialog-footer"] button')].map(button=>button.getBoundingClientRect());
            return {inset:buttons.every(button=>button.left>=box.left+20 && button.right<=box.right-20 && button.bottom<=box.bottom-20),sameRow:Math.abs(buttons[0].top-buttons[1].top)<1,equalWidth:Math.abs(buttons[0].width-buttons[1].width)<1,removeBelow:buttons[2].top>=buttons[0].bottom+7};
          });
          assert.deepEqual(footerLayout,{inset:true,sameRow:true,equalWidth:true,removeBelow:true});
          await page.locator('input[type="file"]').setInputFiles(new URL('../public/favicon.png',import.meta.url).pathname);
          await page.getByRole("dialog").waitFor({state:"hidden"});assert.match(profile.image,/^data:image\/jpeg;base64,/);
          await page.getByRole("button",{name:"Change",exact:true}).click();
          await page.getByRole("button",{name:"Remove picture",exact:true}).click();
          await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(profile.image,null);
          await page.getByRole("combobox",{name:"Default permission level",exact:true}).click();
          await page.getByRole("option",{name:"Plan",exact:true}).click();
          await page.reload();await page.getByRole("combobox",{name:"Default permission level",exact:true}).getByText("Plan",{exact:true}).waitFor();
          assert.equal(permissionMode,"plan");assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
          await context.close();console.log(`General settings passed: ${returning?'saved':'fresh'}, ${mobile?'phone':'desktop'}.`);continue;
        }
        if(process.env.QA_START_ONLY === "1") {
          const entry=modelEntries.find(p=>p.id==="openrouter");entry.enabled=true;entry.configured=true;entry.models=["openrouter/auto"];
          remyDefault={provider:"openrouter",model:"openrouter/auto"};preference="cloud:fly-sprites";
          await page.reload();await page.getByRole("button",{name:"Branch",exact:true}).getByText("main",{exact:true}).waitFor();
          await page.locator("#hub-thread-message").fill("Hello startup QA");
          const at=Date.now();await page.getByRole("button",{name:"Send",exact:true}).click();
          await page.getByLabel("Thread transcript",{exact:true}).waitFor();
          assert.ok(Date.now()-at<1500,"Thread view must open before provisioning returns");
          await page.getByLabel("Starting thread",{exact:true}).waitFor();
          await page.getByRole("tab", {name:"Hello startup QA", exact:true}).waitFor();
          assert.equal(await page.getByRole("heading", {name:"Threads", exact:true}).count(), 0);
          await page.getByRole("button", {name:"Thread details", exact:true}).click();
          await page.getByRole("menu", {name:"Thread details"}).getByText("Private", {exact:true}).waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("menu").waitFor({state:"hidden"});
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

          if(mobile) await page.getByRole("button",{name:"Toggle Sidebar",exact:true}).click();
          await page.getByRole("button",{name:"Hello startup QA",exact:true}).waitFor();
          if(mobile) await page.locator('[data-slot="sheet-overlay"]').click({position:{x:380,y:400}});
          assert.equal(await page.getByText("Preparing your thread…",{exact:true}).count(),0);
          releaseStart();await page.getByRole("alert").getByText("Fly.io could not start. Retry to continue.").waitFor();
          const pendingUrl=page.url();
          await page.goto(target.href);
          await page.locator("#hub-thread-message").waitFor();
          assert.equal(await page.getByLabel("Thread transcript",{exact:true}).count(),0);
          await page.goto(pendingUrl);
          await page.reload();await page.getByRole("button",{name:"Retry",exact:true}).click();
          await page.getByText("Connection interrupted. Retry to send.",{exact:true}).waitFor();
          await page.getByRole("button",{name:"Retry",exact:true}).click();
          await page.waitForURL(/computer=sprite/);
          await page.getByRole("button",{name:"Send",exact:true}).waitFor();
          assert.equal(startCalls,2);assert.equal(new Set(startIds).size,1);assert.equal(messageCalls,2);assert.equal(new Set(messageIds).size,1);
          assert.equal(await page.getByRole("button",{name:"Retry",exact:true}).count(),0);
          const transcript = page.getByLabel("Thread transcript",{exact:true});
          await transcript.getByRole("img",{name:"Codex",exact:true}).waitFor();
          assert.equal(await transcript.getByText("Agent",{exact:true}).count(),0);
          if(mobile) await page.getByRole("button",{name:"Toggle Sidebar",exact:true}).click();
          const sidebarRow=page.locator('.sidebar-thread').filter({hasText:"Hello startup QA"});
          await sidebarRow.locator('.sidebar-thread-context').getByText("Done",{exact:true}).waitFor({state:"attached"});
          assert.equal(await sidebarRow.getByRole("img",{name:"Codex",exact:true}).count(),1);
          if(mobile) await page.locator('[data-slot="sheet-overlay"]').click({position:{x:380,y:400}});
          await page.getByRole("button",{name:"Copy branch feature/working",exact:true}).waitFor();
          startedThread.detail.branch="feature/switched";startedThread.revision++;
          for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"snapshot",cursor:2,thread:startedThread}));}catch{}
          await page.getByRole("button",{name:"Copy branch feature/switched",exact:true}).waitFor();
          await page.reload();
          await page.getByRole("button",{name:"Copy branch feature/switched",exact:true}).waitFor();
          if(mobile) await page.getByRole("button",{name:"Toggle Sidebar",exact:true}).click();
          const faces=page.locator('.sidebar-thread [data-slot="avatar-group"]');
          assert.equal(await faces.locator('[data-slot="avatar"]').count(),2);
          assert.equal(await page.locator('.sidebar-thread-context').getByRole('img',{name:'Codex',exact:true}).count(),0);
          for(const [count,overflow] of [[1,0],[2,2],[4,4],[0,0]]) {
            startedThread.access.participants=[startedThread.access.owner,...Array.from({length:count},(_,i)=>({id:`p${i}`,label:`Person ${i}`}))];
            startedThread.revision++;
            for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"snapshot",cursor:10+startedThread.revision,thread:startedThread}));}catch{}
            await page.waitForFunction(({count,overflow})=>{
              const group=document.querySelector('.sidebar-thread [data-slot="avatar-group"]');
              return group?.querySelectorAll('[data-slot="avatar"]').length===(overflow?2:count+2) && (group.querySelector('[data-slot="avatar-group-count"]')?.textContent??'')===(overflow?'+'+overflow:'');
            },{count,overflow});
            if(count===1) await faces.locator('[data-slot="avatar-image"]').waitFor();
          }
          if(mobile) await page.locator('[data-slot="sheet-overlay"]').click({position:{x:380,y:400}});
          const reply=page.getByRole("textbox",{name:"Message",exact:true});
          assert.equal(await page.getByRole("button",{name:"Send",exact:true}).isDisabled(),true);
          assert.equal(await page.getByRole("button",{name:"Stop",exact:true}).count(),0);
          assert.equal(await page.locator('input[type="file"]:visible').count(),0);
          await reply.fill("Reply QA");await reply.press("Shift+Enter");
          assert.equal(messageCalls,2);
          await reply.press("Enter");
          await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message"]')?.value==='');
          assert.equal(messageCalls,3);
          await reply.evaluate((node,bytes)=>{
            const transfer=new DataTransfer();
            transfer.items.add(new File([new Uint8Array(bytes)],"avatar.png",{type:"image/png"}));
            node.dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:transfer}));
          },[...readFileSync(new URL('../public/favicon.png',import.meta.url))]);
          await page.getByRole("button",{name:"Send",exact:true}).waitFor();
          await page.waitForFunction(()=>!document.querySelector('button[aria-label="Send"]')?.disabled);
          await page.getByRole("button",{name:"Send",exact:true}).click();
          await page.waitForFunction(()=>document.querySelector('button[aria-label="Send"]')?.disabled);
          assert.deepEqual(lastMessage.attachmentIds,["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);

          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
          await context.close();console.log(`Optimistic startup passed: ${returning?'saved state':'fresh'}, ${mobile?'touch phone':'desktop'}.`);continue;
        }
        if(process.env.QA_COMPUTER_DEFAULTS_ONLY === "1") {
          const entry=modelEntries.find(p=>p.id==="openrouter");entry.enabled=true;entry.configured=true;entry.models=["openrouter/auto","test/computer","test/workspace","test/manual"];
          remyDefault={provider:"openrouter",model:"openrouter/auto"};preference="cloud:fly-sprites";
          const settingsTarget=new URL(url);settingsTarget.hash="/settings/devices?device=cloud&organization=personal";await page.goto(settingsTarget.href);
          const provider=page.getByRole("form",{name:"Fly.io Sprites connection"});
          await provider.locator('[data-model-picker]').click();await page.getByRole("option",{name:/test\/computer/}).click();
          await provider.locator('[data-model-picker]').getByText('test/computer',{exact:true}).waitFor();
          assert.equal(computerDefaults.get('cloud:fly-sprites').model,'test/computer');
          await page.goto(target.href);await page.reload();
          const model=page.getByRole("button",{name:"Model",exact:true});await model.getByText("test/computer",{exact:true}).waitFor();
          const computer=page.getByLabel('Thread computer',{exact:true});await computer.click();await page.getByRole('menuitem',{name:'Cloud · Modal',exact:true}).click();await model.getByText('openrouter/auto',{exact:true}).waitFor();
          await computer.click();await page.getByRole('menuitem',{name:'Cloud · Fly.io Sprites',exact:true}).click();await model.getByText('test/computer',{exact:true}).waitFor();
          workspaceDefault={provider:'openrouter',model:'test/workspace'};await page.reload();await model.getByText('test/workspace',{exact:true}).waitFor();
          await model.click();await page.getByRole('option',{name:/test\/manual/}).click();await computer.click();await page.getByRole('menuitem',{name:'Cloud · Modal',exact:true}).click();await model.getByText('test/manual',{exact:true}).waitFor();
          await page.locator('#hub-thread-message').fill('Computer default QA');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Preview request captured.',{exact:true}).waitFor();assert.equal(threadInput.model,'remy:openrouter:test/manual');
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);await context.close();console.log(`Computer defaults passed: ${returning?'saved local state':'fresh profile'}, ${mobile?'touch phone':'desktop'}.`);continue;
        }
        if(process.env.QA_DEFAULTS_ONLY === "1") {
          const entry=modelEntries.find(p=>p.id==="openrouter");entry.enabled=true;entry.configured=true;entry.models=["openrouter/auto","test/workspace","test/manual"];
          const settingsTarget=new URL(url);settingsTarget.hash="/settings/general?organization=personal";await page.goto(settingsTarget.href);
          await page.locator("[data-model-picker]:visible").click();await page.getByRole("option",{name:/openrouter\/auto/}).click();
          await page.locator("[data-model-picker]:visible").getByText("openrouter/auto",{exact:true}).waitFor();
          assert.equal(remyDefault.model,"openrouter/auto");
          await page.goto(target.href);
          const model=page.getByRole("button",{name:"Model",exact:true});
          await page.reload();await model.getByText("openrouter/auto",{exact:true}).waitFor();
          const workspaceTarget=new URL(url);workspaceTarget.hash="/workspaces/repo?organization=personal";await page.goto(workspaceTarget.href);
          await page.locator('[data-model-picker]:visible').click();await page.getByRole("option",{name:/test\/workspace/}).click();
          await page.locator("[data-model-picker]:visible").getByText("test/workspace",{exact:true}).waitFor();assert.equal(workspaceDefault.model,"test/workspace");
          await page.goto(target.href);await model.getByText("test/workspace",{exact:true}).waitFor();
          await model.click();await page.getByRole("option",{name:/test\/manual/}).click();
          await model.getByText("test/manual",{exact:true}).waitFor();
          for(const socket of liveSockets)try{socket.send(JSON.stringify({kind:"model-defaults.changed"}));}catch{}
          await page.locator("#hub-thread-message").fill("Default selection QA");await page.getByRole("button",{name:"Send",exact:true}).click();
          await page.getByText("Preview request captured.",{exact:true}).waitFor();assert.equal(threadInput.model,"remy:openrouter:test/manual");
          workspaceDefault=null;await page.goto(target.href);await model.getByText("openrouter/auto",{exact:true}).waitFor();
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
          await context.close();console.log(`Model defaults passed: ${returning?"saved local state":"fresh profile"}, ${mobile?"touch phone":"desktop"}.`);continue;
        }
        if (process.env.QA_BRANCH_ONLY === "1") {
          const model=page.getByRole("button",{name:"Model",exact:true});
          await model.waitFor();
          const font=el=>{const s=getComputedStyle(el);return {font:s.font,color:s.color};};
          assert.deepEqual(await model.evaluate(font),await page.getByLabel("Thread computer",{exact:true}).evaluate(font));
          assert.equal(await model.locator("svg").count(),2);
          const branch=page.getByRole("button",{name:"Branch",exact:true});
          await branch.click();await page.getByPlaceholder("Search branches").fill("feature/");
          await page.getByRole("option",{name:"feature/selected",exact:true}).click();
          await branch.getByText("feature/selected",{exact:true}).waitFor();
          await branch.click();await page.keyboard.press("Escape");
          await branch.getByText("feature/selected",{exact:true}).waitFor();
          modelEntries.find(p=>p.id==="openrouter").enabled=true;
          modelEntries.find(p=>p.id==="openrouter").configured=true;
          modelEntries.find(p=>p.id==="openrouter").models=["openrouter/auto"];
          await page.reload();await branch.click();await page.getByRole("option",{name:"feature/selected",exact:true}).click();
          await model.click();await page.getByRole("option",{name:/openrouter\/auto/}).click();
          await page.locator("#hub-thread-message").fill("Branch selection QA");
          await page.getByRole("button",{name:"Send",exact:true}).click();
          await page.getByText("Preview request captured.",{exact:true}).waitFor();
          assert.equal(threadInput.branch,"feature/selected");
          assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
          await context.close();console.log(`Branch selection passed: ${returning?"saved local state":"fresh profile"}, ${mobile?"touch phone":"desktop"}.`);continue;
        }
        const control=page.getByLabel("Thread computer",{exact:true});
        await page.locator('[aria-label="Thread computer"]:not([disabled])').waitFor();
        const style=()=>control.evaluate(el=>{const s=getComputedStyle(el);return {tag:el.tagName,font:s.font,gap:s.gap,padding:s.padding,height:el.getBoundingClientRect().height};});
        const before=await style();
        await control.click();await page.getByRole("menuitem",{name:"Cloud · Fly.io Sprites",exact:true}).click();
        await page.locator('[aria-label="Thread computer"][aria-busy="true"]').waitFor();
        assert.deepEqual(await style(),before);
        await page.locator('[aria-label="Thread computer"]:not([disabled])').waitFor();
        assert.equal(preference,"cloud:fly-sprites");assert.deepEqual(await style(),before);
        await page.reload();await control.getByText("Cloud · Fly.io Sprites",{exact:true}).waitFor();
        failPreference=true;await control.click();await page.getByRole("menuitem",{name:"Cloud · Modal",exact:true}).click();
        await page.getByText("Your computer choice could not be saved. Try again.",{exact:true}).waitFor();
        await control.getByText("Cloud · Fly.io Sprites",{exact:true}).waitFor();
        assert.equal(await page.getByText("Internal server error",{exact:true}).count(),0);
        assert.equal(preference,"cloud:fly-sprites");assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
        await context.close();console.log(`Computer selection passed: ${returning?"saved local state":"fresh profile"}, ${mobile?"touch phone":"desktop"}.`);continue;
      }
      const coldTarget = new URL(url);
      coldTarget.hash = "/threads?organization=team";
      await page.goto(coldTarget.href);
      try {
        const workspaceLoading = page.getByRole("status", {name:"Loading workspaces", exact:true});
        await workspaceLoading.waitFor();
        const before = await workspaceLoading.boundingBox();
        releaseWorkspaces();
        const computerLoading = page.getByRole("status", {name:"Checking your computers", exact:true});
        await computerLoading.waitFor();
        assert.deepEqual(await computerLoading.boundingBox(), before, "Loading stays in the same place as independent reads finish");
        releaseComputers();
        holdSetupReads = false;
        await page.getByText("Set up your first computer", {exact:true}).waitFor();
        assert.equal(requests.filter(path => path === "/api/organizations/team/threads").length, 1, "Sidebar and pane share one initial thread read");
      } finally { holdColdReads = false; holdSetupReads = false; releaseWorkspaces(); releaseComputers(); releaseColdReads(); }
      await page.getByRole("region", {name:"Threads", exact:true}).getByRole("status", {name:"Loading threads"}).waitFor({state:"hidden"});
      for (const org of [personal, team]) {
        modelEntries.forEach(p=>{p.enabled=false;p.configured=false;p.models=[];});
        savedKeys.clear();
        favorites.clear();
        connected = false;
        enabledProviders.clear();
        requests.length = 0;
        const target = new URL(url);
        target.hash = `/threads?organization=${org.id}`;
        await page.goto(target.href);
        await page.getByText("Set up your first computer", { exact: true }).waitFor();
        await page.getByRole("heading", { name: "Threads", exact: true }).waitFor();
        if (artifacts && returning && mobile && org.personal) await page.screenshot({ path: `${artifacts}/threads-phone.png` });
        assert.equal(await page.locator("main header").count(), 1, "Threads has one title bar");
        if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
        if (!mobile) {
          const sidebar = page.locator('[data-slot="sidebar"]');
          assert.equal(await page.locator("main header").getByRole("button", { name: "Toggle Sidebar", exact: true }).count(), 0);
          await sidebar.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
          await page.locator('[data-slot="sidebar"][data-collapsible="icon"]').waitFor();
          assert.ok(await sidebar.getByRole("button", { name: "Settings", exact: true }).isVisible());
          await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
          await page.getByRole("heading", { name: "Computers", exact: true }).waitFor();
          await sidebar.getByRole("button", { name: "Back", exact: true }).click();
          await sidebar.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
          await page.locator('[data-slot="sidebar"][data-state="expanded"]').waitFor();
        }
        assert.equal(await page.getByRole("button", { name: "Computers", exact: true }).count(), 0, "Settings sections stay out of the main sidebar");
        assert.equal(await page.getByRole("button", { name: "Notifications", exact: true }).count(), 0);
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("heading", { name: "Computers", exact: true }).waitFor();
        if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await page.getByRole("heading", { name: "Threads", exact: true }).waitFor();
        assert.equal(await page.locator("main").getByRole("button", { name: "Notifications", exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Add a workspace", exact: true }).count(), 0);
        await page.reload();
        await page.getByText("Set up your first computer", { exact: true }).waitFor();
        requests.length = 0;
        await page.getByRole("button", { name: "Set up a computer" }).click();
        await page.getByRole("region", { name: "Cloud settings", exact: true }).waitFor();
        assert.equal(await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button").first().innerText(), "Cloud");
        await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Connected", exact: true }).click();
        await page.getByText("No computers connected", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Add computer", exact: true }).count(), 0);
        await page.getByRole("button", { name: "Connect a Mac", exact: true }).click();
        await page.getByRole("region", { name: "General computer settings" }).waitFor();
        const download = page.getByRole("link", { name: "Download for Mac", exact: true });
        const guide = page.getByRole("link", { name: "Read the setup guide", exact: true });
        const downloadBox = await download.boundingBox(), guideBox = await guide.boundingBox();
        assert.ok(Math.abs(downloadBox.width - guideBox.width) < 1, "Mac setup actions have equal widths");
        await page.reload();
        await page.getByRole("region", { name: "General computer settings" }).waitFor();
        await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Cloud", exact: true }).click();
        target.hash = `/settings/devices?organization=${org.id}&device=cloud`;
        await page.goto(target.href);
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await page.getByRole("region", { name: "Cloud settings", exact: true }).waitFor();
          await page.getByRole("heading", { name: "Providers", exact: true }).waitFor();
          assert.equal(await page.getByRole("button",{name:"Add computer",exact:true}).count(),0);
          assert.equal(await page.getByLabel("Hosted workspace").count(), 0);
          assert.equal(await page.getByRole("button", { name: "Add a workspace", exact: true }).count(), 0);
          assert.equal(await page.getByRole("button", { name: "Attach this Mac", exact: true }).count(), 0);
          if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
          await page.getByRole("button", { name: "Notifications", exact: true }).click();
          await page.getByRole("dialog").waitFor();
          await page.keyboard.press("Escape");
          if (artifacts && returning && mobile && org.personal) await page.screenshot({ path: `${artifacts}/computers-phone.png` });
          assert.ok(await page.locator("section[aria-label=Computers]").evaluate(e => e.scrollWidth <= e.clientWidth), "Computers must fit the phone viewport");
        }
        connected = true;
        target.hash = `/settings/devices?organization=${org.id}&device=computers`;
        await page.goto(target.href);
        await page.reload();
        await page.locator('[data-computer-id="studio"]').waitFor();
        assert.equal(await page.getByRole("navigation", {name:"Computer settings"}).getByRole("button").count(),2);
        await page.getByRole("button",{name:"Add computer",exact:true}).click();
        await page.getByRole("region",{name:"General computer settings"}).waitFor();
        await page.getByRole("navigation",{name:"Computer settings"}).getByRole("button",{name:"Connected",exact:true}).click();

        await page.reload();
        await page.locator('[data-computer-id="studio"]').waitFor();
        if (artifacts && org.personal) await page.screenshot({ path: `${artifacts}/computers-${mobile ? "phone" : "desktop"}.png` });
        await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Connected", exact: true }).click();
        await page.getByRole("button", { name: computerName, exact: true }).click();
        await page.locator('[data-computer-id="studio"]').waitFor();
        assert.ok(await page.locator('section[aria-label="Computers"]').evaluate(e => e.scrollWidth <= e.clientWidth), "Long computer names fit the available width");
        await page.reload();
        await page.locator('[data-computer-id="studio"]').waitFor();
        connected = false;
        await page.reload();
        await page.getByText("Computer unavailable", { exact: true }).waitFor();
        await page.getByRole("button", { name: "View computers", exact: true }).click();
        await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Cloud", exact: true }).click();
        available = false;
        await page.reload();
        await page.getByRole("button", { name: "Check availability again" }).waitFor();
        for (const [name, tokenLabel] of [["Fly.io Sprites", "Sprites token"], ["Modal", "Token secret"]]) {
          const form = page.getByRole("form", { name: `${name} connection`, exact: true });
          if (!connections.has(name === "Modal" ? "modal" : "fly-sprites")) {
            assert.equal(await form.getByRole("textbox").count(), 0, "Disabled provider cards stay collapsed");
            await form.getByRole("switch", { name, exact: true }).click();
            if (name === "Modal") await form.getByLabel("Token ID", { exact: true }).fill("test-modal-id");
            await form.getByLabel(tokenLabel, { exact: true }).fill("test-provider-secret");
            await form.getByRole("button", { name: "Save connection", exact: true }).click();
            await form.getByRole("button", { name: "Update credentials", exact: true }).waitFor();
          }
          const toggle = form.getByRole("switch", { name, exact: true });
          if (!enabledProviders.has(name === "Modal" ? "modal" : "fly-sprites")) await toggle.click();
          await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Cloud connections"] [role="switch"]')].some(el => el.getAttribute('aria-checked') === 'true'));
        }
        assert.equal(enabledProviders.size, 2, "Both cloud providers can be enabled together");
        await page.reload();
        await page.getByRole("form", { name: "Modal connection", exact: true }).getByRole("switch").waitFor();
        assert.equal(await page.locator('section[aria-label="Cloud connections"] [role="switch"][aria-checked="true"]').count(), 2);
        const flyForm = page.getByRole("form", { name: "Fly.io Sprites connection", exact: true });
        await flyForm.getByRole("switch").click();
        await flyForm.getByRole("button", { name: "Update credentials" }).waitFor({ state: "hidden" });
        assert.equal(enabledProviders.has("modal"), true, "Disabling Fly leaves Modal enabled");
        await flyForm.getByRole("switch").click();
        await flyForm.getByRole("button", { name: "Update credentials" }).waitFor();
        failToggle=true;
        await flyForm.getByRole("switch").click();
        assert.equal(await flyForm.getByRole("switch").getAttribute("aria-checked"),"false","Switch responds before the server");
        await flyForm.getByRole("alert").waitFor();
        assert.equal(await flyForm.getByRole("switch").getAttribute("aria-checked"),"true","Failed writes restore the saved value");
        failToggle=false;
        available = true;
        await page.getByRole("button", { name: "Check availability again" }).click();
        assert.equal(await page.getByLabel("Hosted workspace").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Add a workspace", exact: true }).count(), 0);
        assert.equal(await page.getByText("Automatic cloud computers", { exact: true }).count(), 0);
        const modelAccess = page.getByRole("region", {name:"Model access",exact:true});
        for(const [id,label] of [["anthropic","Anthropic"],["openai","OpenAI"],["router","Router.com"],["openrouter","OpenRouter"]]) {
          const section=modelAccess.getByRole("region",{name:`${label} model access`,exact:true});
          const toggle=section.getByRole("switch",{name:label,exact:true});
          await toggle.click();
          const field=section.getByRole("textbox",{name:`${label} API key`,exact:true});
          await field.fill(`disposable-${id}-key`);
          await page.waitForFunction(label=>!document.querySelector(`section[aria-label="${label} model access"] [aria-label="Saving key"]`),label);
          await field.getAttribute("placeholder").then(async value=>{if(value!=="••••••••")await page.waitForFunction(label=>document.querySelector(`section[aria-label="${label} model access"] input`)?.getAttribute("placeholder")==="••••••••",label);});
          assert.equal(savedKeys.get(id),`disposable-${id}-key`);
          assert.equal(await section.getByRole("button").count(),0);
          await toggle.click();
          await page.waitForFunction(label=>!document.querySelector(`section[aria-label="${label} model access"] [aria-label="Saving key"]`),label);
          assert.equal(savedKeys.get(id),`disposable-${id}-key`);
          await toggle.click();
          await page.waitForFunction(label=>!document.querySelector(`section[aria-label="${label} model access"] [aria-label="Saving key"]`),label);
          assert.equal(await field.inputValue(),"");
          assert.equal(await field.getAttribute("placeholder"),"••••••••");
          await toggle.click();
          await page.waitForFunction(label=>document.querySelector(`section[aria-label="${label} model access"] button[role="switch"]`)?.getAttribute("aria-checked")==="false",label);
        }
        assert.ok(await page.locator('section[aria-label="Cloud settings"]').evaluate(e => e.scrollWidth <= e.clientWidth));
        if (artifacts && org.personal) await page.screenshot({path: `${artifacts}/cloud-configured-${mobile ? "phone" : "desktop"}.png`});
        if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        connected = true;
        enabledProviders.clear();
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await page.getByText("Your computer is unavailable", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Add a workspace", exact: true }).count(), 0);
        connected = false;
        enabledProviders.add("modal");
        cloudEnabled = true;
        await page.reload();
        await page.getByText("Add your first workspace", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Add a workspace", exact: true }).waitFor();
        cloudEnabled = false;
        connected = true;
        online = true;
        await page.reload();
        await page.getByRole("button", { name: "Add a workspace", exact: true }).waitFor();
        modelEntries.filter(p=>p.id==="router" || p.id==="openrouter").forEach(p=>p.enabled=true);
        hasWorkspace=true;
        await page.reload();
        const computerStyle = () => page.getByLabel("Thread computer",{exact:true}).evaluate(el=>{ const s=getComputedStyle(el);return {tag:el.tagName,font:s.font,fontWeight:s.fontWeight,lineHeight:s.lineHeight,gap:s.gap,padding:s.padding,height:el.getBoundingClientRect().height}; });
        const normalStyle = await computerStyle();
        await page.getByLabel("Thread computer",{exact:true}).click();
        await page.getByRole("menuitem",{name:"Cloud · Modal",exact:true}).click();
        await page.locator('[aria-label="Thread computer"][aria-busy="true"]').waitFor();
        assert.deepEqual(await computerStyle(),normalStyle,"Saving keeps the same computer control typography and spacing");
        await page.waitForFunction(()=>document.querySelector('[aria-label="Thread computer"]')?.getAttribute("disabled")===null);
        assert.equal(preference,"cloud:modal");
        const composer=page.getByRole("form",{name:"New thread",exact:true});
        await composer.getByRole("button",{name:"Model",exact:true}).click();
        await page.getByPlaceholder("Search providers and models",{exact:true}).fill("OpenRouter");
        await page.getByRole("button",{name:"Add test/model-b to favorites",exact:true}).click();
        await page.getByRole("group",{name:"Favorites",exact:true}).waitFor();
        assert.equal(favorites.size,1);
        await page.keyboard.press("Escape");
        await page.reload();
        await composer.getByRole("button",{name:"Model",exact:true}).click();
        await page.getByRole("group",{name:"Favorites",exact:true}).getByText("test/model-b",{exact:true}).click();
        await composer.getByRole("button",{name:"Model",exact:true}).getByText("test/model-b",{exact:true}).waitFor();
        await composer.getByLabel("Message",{exact:true}).fill("Test selected model");
        await composer.getByRole("button",{name:"Send",exact:true}).click();
        await page.getByText("Preview request captured.",{exact:true}).waitFor();
        assert.equal(threadInput.provider,"codex");
        assert.equal(threadInput.model,"remy:openrouter:test/model-b");

        target.hash = `/threads?organization=${org.id}`;
        await page.goto(target.href);
        await page.reload();
        await page.getByLabel("Thread computer",{exact:true}).getByText("Cloud · Modal",{exact:true}).waitFor();
        await composer.getByRole("button",{name:"Model",exact:true}).click();
        disconnectLive = true;
        await Promise.all(liveSockets.splice(0).map(socket => socket.close()));
        await page.getByRole("group",{name:"Favorites",exact:true}).getByRole("button",{name:"Remove test/model-b from favorites",exact:true}).click();
        await page.getByRole("group",{name:"Favorites",exact:true}).waitFor({state:"hidden"});
        assert.equal(favorites.size,0);
        disconnectLive = false;
        await page.keyboard.press("Escape");
        hasWorkspace=false;
        online = false;
        if (mobile) await page.locator('[data-mobile="true"]').waitFor({ state: "hidden" });
        target.hash = `/settings/environments?organization=${org.id}`;
        await page.goto(target.href);
        await page.getByText("Define values once", { exact: false }).waitFor();
        assert.ok(requests.includes(`/api/organizations/${org.id}/environments`));
      }
      assert.deepEqual(unexpected, [], "Hosted navigation must not request local APIs or unknown endpoints");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Hosted runtime passed: ${returning ? "saved local state" : "fresh profile"}, ${mobile ? "touch phone" : "desktop"}.`);
    }
  }
} finally {
  await browser.close();
}
