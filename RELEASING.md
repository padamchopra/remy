# Releasing builds

## Computer builds

The `Release` workflow publishes what a computer runs: the Linux computer image
on GHCR and its archive on a GitHub release, so a cloud computer and a machine
you install by hand come from the same build.

It runs when a merge to main changes `contract/`, `server/`, `web/`, the
computer image, or the workflow itself, at 00:05 UTC nightly, and on demand from
the Actions tab. A merge that only touches the phone app or the docs ships
nothing. See **What decides a build** below.

The tag is `{major}.{minor}.{run}` from `package.json` plus the workflow run
number (`v0.1.5`, `v0.1.6`, …), so each build is its own release. Do not bump
`version` in `package.json` by hand.

The Mac app is not part of a release. It lives on the long-lived
`padam/desktop-electron-9236` branch, which still carries `desktop/` and its
signing and notarisation workflow; nothing on `main` builds a DMG.

## What decides a build

The workflow asks one question before spending a runner, and keeps its answer in
a branch: `nightly/release` holds the commit it last shipped. A run builds when
something it ships changed between that marker and the head of main, and moves
the marker only after the build succeeds — so a build that fails is one the next
merge or the next night tries again, and a quiet day ships nothing.

Both triggers share that marker, which is why a nightly is usually silent: the
merge already shipped that commit. The nightly is the safety net for a merge
whose build never ran or did not finish.

The branch needs no setup. It does not exist until the first build creates it,
and until it does, the first run builds once whatever changed. A run you ask for
by hand always builds, and only main moves the marker, so a build from a branch
leaves the nightly's measurement alone.

Nothing reads that branch but the workflow. Deleting it makes the next run build
once and write it again.

Markdown is excluded, so a docs-only merge ships nothing. Editing the workflow
or `.github/actions/` counts as a change, because it changes how the build is
made.

## Building locally

```sh
npm run install:computer   # contract + server + web
npm test                   # the contract, the daemon, and the CLI
npm run build              # the web app
```

## Updating a computer

Pull and rebuild on that machine, then `remy start` again:

```sh
git pull && npm --prefix server ci && npm --prefix server run build
```

A daemon installed as a login item by `deploy/setup.sh` can use the
authenticated update endpoint after one manual `git pull` and rebuild.
