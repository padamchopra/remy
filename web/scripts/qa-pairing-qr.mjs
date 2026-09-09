import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { build } from "../../hub/node_modules/esbuild/lib/main.js";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/pairing-qr";
mkdirSync(out, { recursive: true });
const value =
  "remy://configure?url=" +
  encodeURIComponent("https://studio-mac.tail123456.ts.net") +
  "&token=" +
  "a".repeat(64);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PairingQr}from'./src/components/PairingQr';import{ScanScreen}from'../mobile/src/screens/ScanScreen';window.calls=0;window.cancelled=0;function App(){return location.pathname==='/scan'?<ScanScreen onCancel={()=>window.cancelled++} onCode={()=>{window.calls++;return new Promise((resolve,reject)=>{window.finish=resolve;window.fail=reject;});}}/>:<PairingQr value={${JSON.stringify(value)}}/>;}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd() + "/web",
    loader: "tsx",
  },
  alias: { react: process.cwd() + "/web/node_modules/react" },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  plugins: [
    {
      name: "native-camera-fixture",
      setup(b) {
        b.onResolve({ filter: /^(react-native|expo-camera)$/ }, (a) => ({
          path: a.path,
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          loader: "jsx",
          resolveDir: process.cwd() + "/web",
          contents:
            a.path === "expo-camera"
              ? `import React from 'react';export function useCameraPermissions(){return [{granted:true},async()=>{}];}export function CameraView(props){window.scan=data=>props.onBarcodeScanned?.({data});window.cameraError=()=>props.onMountError?.({message:'fixture'});return <div aria-label="Camera preview" style={{position:'absolute',inset:0,background:'#333'}}/>;}`
              : `import React from 'react';const flatten=s=>Object.assign({},...[s].flat(Infinity).filter(Boolean));const style=s=>{const v=flatten(s);if(v.flex)v.display='flex';return v;};export const StyleSheet={create:s=>s,absoluteFill:{position:'absolute',inset:0}};export const Linking={openSettings:async()=>{}};export const View=({children,style:s})=><div style={{display:'flex',flexDirection:'column',...style(s)}}>{children}</div>;export const Text=({children,style:s})=><span style={style(s)}>{children}</span>;export const ActivityIndicator=()=> <span role="progressbar">◌</span>;export const Pressable=({children,style:s,onPress,disabled})=><button disabled={disabled} onClick={onPress} style={{border:0,...style(typeof s==='function'?s({pressed:false}):s)}}>{children}</button>;`,
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(
    `<style>body{margin:0;background:#202020;color:white;font-family:system-ui}#root{height:100vh;display:flex;flex-direction:column}svg{margin:24px;flex-shrink:0;max-width:calc(100% - 48px);height:auto;align-self:flex-start}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: chromiumPath() }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  }),
  initialPage = await context.newPage();
let page = initialPage,
  scanContext;
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/qr`);
  await page
    .getByRole("img", { name: "Pairing QR" })
    .screenshot({ path: out + "/qr.png" });
  writeFileSync(out + "/expected.txt", value);
  execFileSync(
    "clang",
    [
      "-framework",
      "Foundation",
      "-framework",
      "AppKit",
      "-framework",
      "Vision",
      "web/scripts/decode-pairing-qr.m",
      "-o",
      out + "/decode",
    ],
    { stdio: "pipe" },
  );
  console.log(
    execFileSync(out + "/decode", [out + "/qr.png", out + "/expected.txt"], {
      encoding: "utf8",
    }).trim(),
  );
  scanContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: out, size: { width: 390, height: 844 } },
  });
  page = await scanContext.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/scan`);
  await page.getByText("Point at the QR on your computer.").waitFor();
  await page.evaluate(() => window.scan("https://example.test"));
  await page.getByText(/That is not a Remy pairing code/).waitFor();
  assert.equal(await page.evaluate(() => window.calls), 0);
  await page.evaluate((v) => {
    window.scan(v);
    window.scan(v);
  }, value);
  await page.getByText("Connecting to your computer…").waitFor();
  assert.equal(await page.evaluate(() => window.calls), 1);
  assert.ok(
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .isDisabled(),
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "/connecting.png" });
  await page.evaluate(() =>
    window.fail(Object.assign(new Error("aborted"), { name: "AbortError" })),
  );
  await page
    .getByText(
      "Your computer did not answer; check Tailscale on both devices and try again.",
    )
    .waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "/retry.png" });
  await page.evaluate((v) => window.scan(v), value);
  assert.equal(await page.evaluate(() => window.calls), 1);
  await page.getByRole("button", { name: "Scan again", exact: true }).click();
  await page.evaluate((v) => window.scan(v), value);
  assert.equal(await page.evaluate(() => window.calls), 2);
  await page.evaluate(() => window.finish());
  await page.getByRole("progressbar").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Use pairing link", exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.cancelled), 1);
  console.log(
    "PASS: production ScanScreen accepts one scan, reports invalid QR, shows pending connection, reports failure, retries explicitly and offers pairing-link fallback (native camera/views replaced with browser adapters).",
  );
} finally {
  await scanContext?.close();
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(`VIDEO=${await page.video().path()}`);
