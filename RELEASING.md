# Releasing builds

## TestFlight

The `TestFlight` workflow queues a store-signed iOS build, then hands the
finished build to TestFlight. It runs when a merge to main changes `mobile/`, at
00:20 UTC nightly, and on demand from the Actions tab. A merge that leaves the
phone app alone spends no EAS build on it — see **What decides a build** below.

EAS keeps the iOS build number and increments it for every build. The version
shown in TestFlight is `0.1.<run>`, where `run` is that TestFlight workflow's run
number. For example, TestFlight workflow run 12 publishes version `0.1.12`.

The workflow hands the build to EAS and stops rather than waiting on it, so
`nightly/testflight` records what was queued. A build that EAS fails after that
is one to ask for by hand from the Actions tab.

The upload goes to TestFlight only. It does not submit the app for App Review.
Remy declares that it uses only standard or exempt encryption in its Expo iOS
configuration, so each uploaded build arrives without the manual export
compliance questionnaire.

### One-time setup

1. From `mobile/`, run `npx eas-cli@latest init` and create or link the Remy EAS
   project. Copy its project ID.
2. In App Store Connect, create the Remy app with bundle identifier
   `me.padamchopra.remy` if it does not already exist. Copy the numeric Apple ID
   from App Information.
3. Create an Expo access token at <https://expo.dev/settings/access-tokens>.
4. Add this GitHub Actions secret to `padamchopra/remy`:

   | Secret | Value |
   |---|---|
   | `EXPO_TOKEN` | Expo access token for the account that owns the EAS project |

5. Add these GitHub Actions repository variables:

   | Variable | Value |
   |---|---|
   | `EAS_PROJECT_ID` | EAS project UUID copied in step 1 |
   | `ASC_APP_ID` | Numeric Apple ID copied in step 2 |

6. Run `npx eas-cli@latest credentials --platform ios` from `mobile/` with the
   `testflight` profile. Configure the iOS distribution credentials and an App
   Store Connect API key for EAS Submit.
7. Merge a change to `mobile/`, wait for the nightly, or open Actions →
   TestFlight → Run workflow to build straight away.

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

Both workflows ask the same question before spending a runner, and each keeps
its answer in a branch: `nightly/release` and `nightly/testflight` hold the commit
that target last shipped. A run builds when something it ships changed between
that marker and the head of main, and moves the marker only after the build
succeeds — so a build that fails is one the next merge or the next night tries
again, and a quiet day ships nothing.

The two triggers share one marker, which is why a nightly is usually silent: the
merge already shipped that commit. The nightly is the safety net for a merge
whose build never ran or did not finish.

The branches need no setup. Neither exists until the first build creates it, and
until it does, the first run of each workflow builds once whatever changed. A
run you ask for by hand always builds, and only main moves a marker, so a build
from a branch leaves the nightly's measurement alone.

Nothing reads these branches but the workflows. Deleting one makes the next run
build once and write it again.

Markdown is excluded, so a docs-only merge ships nothing. Editing the workflow
or `.github/actions/` counts as a change, because it changes how the build is
made.

## Building locally

```sh
npm run install:computer   # contract + server + web
npm test                   # the daemon, the CLI, and the phone's contract rules
npm run build              # the web app
```

## Updating a computer

Pull and rebuild on that machine, then `remy start` again:

```sh
git pull && npm --prefix server ci && npm --prefix server run build
```

A daemon installed as a login item by `deploy/setup.sh` can use the
authenticated update endpoint after one manual `git pull` and rebuild.
