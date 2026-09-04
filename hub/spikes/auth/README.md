# Workers authentication spike

This disposable H1 spike proves Better Auth can run on a Cloudflare Worker with a D1 binding, issue and consume a magic link, and load the SSO plugin against an OIDC test provider.

It uses only local Wrangler state. The fixed secret and test routes are intentionally unsuitable for deployment.

```sh
npm install
npm run check
npm run dev
npm run smoke
```

The smoke run migrates a fresh local D1 database, verifies a magic link into a session, registers the local OIDC provider, and confirms SSO begins at that provider.
