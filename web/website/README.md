# Remy website

The landing page, guides, and changelog are a separate static Vite build. They do not start Remy's local server or require a Remy account.

```sh
npm --prefix contract ci
npm --prefix web ci
npm run dev:website
```

For a production build and browser checks:

```sh
npm run build:website
python3 -m http.server 5180 --bind 127.0.0.1 --directory web/dist-website
# In another terminal, with Playwright Chromium installed:
node web/scripts/website-check.mjs
node web/scripts/website-performance.mjs
```

`WEBSITE_URL` overrides the test origin. `CHROMIUM_PATH` overrides the browser binary; `WEBSITE_ARTIFACTS` overrides the capture directory.

## Shared product preview

`demo/main.tsx` imports `AppSidebar`, `ThreadWorkbench`, `ChatView`, `WorkspaceWorktrees`, `AgentRoutines`, and `ThreadDiff` directly from the app. `ui.css` includes the app's styles. Do not copy their markup into marketing components or replace the preview with an image.

`demo/state.ts` provides sample threads and in-memory actions. Messages return a clearly labeled canned reply; no provider executes work. Reset restores the sample conversations. The narrow layout uses the same `ChatView` with a sample-thread picker. Feature previews include the shared worktree list and extracted thread diff renderer as well as sample conversations; no real worktrees or routines execute.

The website Vite config substitutes `demo/transport.ts` for the app transport and fails the build if the live transport enters the bundle. The demo's Content Security Policy also blocks network connections. The landing-page iframes are inert, scaled component previews so touch gestures scroll the website. The live demo link opens the interactive app view on its own page. Marketing CSS explicitly restores document scrolling after importing app styles; never inherit the app’s `overflow: hidden` on the website body. The iframe keeps app styles and focus separate from the marketing page. New shared components may need explicit sample actions; unsupported actions must not gain access to real computers.

Feature tabs keep the same iframe document mounted and send validated, same-origin scene messages. Keep the ready handshake so a selection made during startup is applied after the app loads. Do not navigate or remount the preview on selection. The performance check switches both tab groups offline at 4× CPU slowdown and verifies that the document survives without a loading placeholder.

Keep sample state synchronized with shared types and behavior. Update guides and release notes proportionally to product changes, following `AGENTS.md`. Only significant, broadly useful capabilities earn homepage space.

## Production

The hub deployment builds this website at `https://tryremy.dev/` and the real app at `https://app.tryremy.dev/` with `npm --prefix web run build:hub`. Keep “Open Remy” pointed at the app subdomain. The Pages project below is for isolated previews.

## Cloudflare preview

Use a separate Cloudflare Pages project; the Teams worker in `hub/` is independent.

One-time project setup:

```sh
npx wrangler pages project create remy-website --production-branch main --force
```

Deploy a built branch without merging or publishing to production:

```sh
npx wrangler pages deploy web/dist-website --project-name remy-website --branch "$(git branch --show-current)" --commit-hash "$(git rev-parse HEAD)"
```

Use a feature branch, not `main`, for previews. Wrangler prints both an immutable deployment URL and a branch alias. `public/_headers` supplies the demo's production security policy. The PR workflow builds and checks the static site; Cloudflare deployment is manual until CI deployment credentials are configured.
