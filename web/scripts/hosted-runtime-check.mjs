import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
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
      let threadInput;
      let hasWorkspace=false;
      let preference=null;
      let failToggle=false;
      let connected = false;
      let cloudEnabled = false;
      let online = false;
      const connections = new Set();
      const enabledProviders = new Set();
      const computerName = returning ? "Studio-Mac-with-a-long-unbroken-name-for-release-and-preview-builds" : "Studio Mac";
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket(/\/api\//, () => {});
      await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        const org = path.startsWith("/api/organizations/team") ? team : personal;
        const base = `/api/organizations/${org.id}`;
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
        if(path === `${base}/routing/preference`){if(route.request().method()==="POST")preference=route.request().postDataJSON().computerId;return route.fulfill({json:{computerId:preference}});}
        if(path===`${base}/hosted/repo/codex`)return route.fulfill({json:{phase:"disconnected"}});
        if(path===`${base}/threads` && route.request().method()==="POST") {
          threadInput=route.request().postDataJSON();
          return route.fulfill({status:409,json:{error:"Preview request captured."}});
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
          [`${base}/threads`]: { threads: [], cursor: 0, member: { id: "reader", role: "owner" } },
          [`${base}/computers`]: { computers: connected ? [{ computerId: "studio", name: computerName, icon: "laptop", ownership: "personal", availability: online ? "online" : "offline", access: { mode: "owner" }, canUse: online, canManage: false, capabilities: { workspaces: [] } }] : [] },
          [`${base}/computers/options`]: { role: "owner", members: [], teams: [] },
          [`${base}/hosted`]: { settings: { enabled: cloudEnabled, provider: "fly-sprites", region: "", cpu: 1, memoryMiB: 2048, maxComputers: 5, idleMinutes: 12 }, secretNames: [], connections: [...connections], enabledProviders: [...enabledProviders], available },
          [`${base}/workspaces`]: { workspaces: hasWorkspace?[{id:"repo",name:"Example",origin:"https://github.com/example/repo"}]:[], canManage: true },
          [`${base}/notifications`]: { notifications: [], devices: [] },
          [`${base}/environments`]: { environments: [], assignments: [], workspaces: [] },
        };
        if (!(path in responses)) unexpected.push(path);
        return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? { error: "Not found" } });
      });
      for (const org of [personal, team]) {
        modelEntries.forEach(p=>{p.enabled=false;p.configured=false;p.models=[];});
        savedKeys.clear();
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
        await page.getByRole("button",{name:"Choose a computer",exact:true}).click();
        await page.getByLabel("Thread computer",{exact:true}).click();
        await page.getByRole("option",{name:"Cloud · Modal",exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('[aria-label="Thread computer"]')?.getAttribute("disabled")===null);
        assert.equal(preference,"cloud:modal");
        const composer=page.getByRole("form",{name:"New thread",exact:true});
        await composer.getByRole("button",{name:"Choose a provider and model",exact:true}).click();
        await page.getByPlaceholder("Search providers and models",{exact:true}).fill("OpenRouter");
        await page.getByRole("option",{name:"test/model-b",exact:true}).click();
        await composer.getByRole("button",{name:"OpenRouter · test/model-b",exact:true}).waitFor();
        await composer.getByLabel("What would you like to work on?",{exact:true}).fill("Test selected model");
        await composer.getByRole("button",{name:"Start thread",exact:true}).click();
        await page.getByText("Preview request captured.",{exact:true}).waitFor();
        assert.equal(threadInput.provider,"codex");
        assert.equal(threadInput.model,"remy:openrouter:test/model-b");

        await page.reload();
        await page.getByRole("button",{name:"Choose a computer",exact:true}).click();
        await page.getByLabel("Thread computer",{exact:true}).getByText("Cloud · Modal",{exact:true}).waitFor();
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
