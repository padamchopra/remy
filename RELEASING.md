# Releasing builds

## TestFlight

The `TestFlight` workflow queues a store-signed iOS build only when you run it
from the Actions tab, then hands the finished build to TestFlight. EAS keeps the
iOS build number and increments it for every build, so the repository version
stays unchanged.

The upload goes to TestFlight only. It does not submit the app for App Review.

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
7. Open Actions → TestFlight → Run workflow, choose `main`, and run it whenever
   you want a new TestFlight build.

## Mac builds

macOS will not open a downloaded app unless Apple has notarized it, so the
`Mac` workflow signs with a Developer ID and notarizes before publishing a
GitHub release. Without the secrets below that job fails on purpose, so an
unsigned build never ships.

It runs at 00:05 UTC nightly, and on demand from the Actions tab when a merge is
worth shipping sooner. A night with nothing new stops before the build — a
release that is the same commit as the last one is only a new number. Asking for
a run by hand always builds.

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

5. Wait for the nightly, or run the **Mac** workflow from the Actions tab.

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
