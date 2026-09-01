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

## Mac builds

macOS will not open a downloaded app unless Apple has notarized it, so the
`Mac` workflow signs with a Developer ID and notarizes before publishing a
GitHub release. Without the secrets below that job fails on purpose, so an
unsigned build never ships.

It runs when a merge to main changes what the app is made of — `desktop/`,
`server/` or `web/`, which the DMG carries together — at 00:05 UTC nightly, and
on demand from the Actions tab. A merge that only touches the phone app or the
docs signs and notarises nothing. See **What decides a build** below.

The tag is `{major}.{minor}.{run}` from `package.json` plus the workflow run
number (`v0.1.5`, `v0.1.6`, …), so each build is its own release. Do not bump
`version` in `package.json` by hand.

## One-time setup

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/).
2. In Keychain Access, create a **Developer ID Application** certificate, export
   it as a `.p12`, then `base64 -i Remy.p12 | pbcopy`.
3. In [App Store Connect](https://appstoreconnect.apple.com/access/api) →
   Integrations → Team Keys, create a key with Developer access. Download the
   `.p8` once. Note the Key ID and the Issuer ID.
4. Add these GitHub Actions secrets on `padamchopra/remy`:

   | Secret | Value |
   |---|---|
   | `CSC_LINK` | base64 of the `.p12` |
   | `CSC_KEY_PASSWORD` | password for that `.p12` |
   | `APPLE_API_KEY` | the `.p8` itself (`gh secret set APPLE_API_KEY < AuthKey_….p8`) or a base64 of that file |
   | `APPLE_API_KEY_ID` | the Key ID |
   | `APPLE_API_ISSUER` | the Issuer UUID |
   | `APPLE_TEAM_ID` | 10-character Team ID |

5. Merge a change to the app, wait for the nightly, or run the **Mac** workflow
   from the Actions tab.

## What decides a build

Both workflows ask the same question before spending a runner, and each keeps
its answer in a branch: `nightly/mac` and `nightly/testflight` hold the commit
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
npm run pack:mac     # web + daemon + Electron DMG → desktop/release/
```

A local build has no Developer ID, so it is ad-hoc signed. After copying it into
Applications, clear quarantine once:

```sh
xattr -cr /Applications/Remy.app
```

## Updating in place

The shipped window offers Download, then Relaunch, using the zip on GitHub
Releases rather than the DMG. A daemon installed as a login item by
`deploy/setup.sh` can use the authenticated update endpoint after one manual
`git pull` and rebuild.
