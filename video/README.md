# video

[Remotion](https://remotion.dev) compositions for Remy's product videos. Nothing
here ships in the app — it renders MP4s to post.

**Read "House rules" before changing any of it.** They are the preferences these
videos have been corrected into, and every one of them cost a re-render.

## House rules

- **A promo carries no technical detail.** No routes, no status codes, no flags,
  no file paths. `POST /pair/pending/:id/approve` and a `401` badge were both on
  screen once; a viewer who stops to read a route has stopped watching the thing
  it was there to explain. `Caption` deliberately has nowhere to put one. The
  mechanism belongs in this file and in the repo.
- **Cut it shorter than feels right.** A single-flow explainer wants **12–16
  seconds**, not twenty. No beat should sit on screen longer than it takes to read
  it once. When in doubt, take frames out — the first cut of this one was 22
  seconds and it felt slow at every point.
- **Never name a kind of computer.** Not "Mac", not "laptop". Remy takes any
  device, the daemon says machine and device, and `DEVICE_ICONS` carries a phone,
  a tablet, a server and a cloud. The rows on screen are a monitor, a server and
  a drive on purpose — the video must not read narrower than the product.
- **The windows are dark, the page is light.** Remy ships dark only: `.light`
  exists in `web/src/index.css` but nothing ever adds the class, so a light mock
  of the app is a screenshot of something nobody is running. Device windows use
  the dark tokens — `#111111` card, `#191919` popover, `#f5f5f5` text, `#346bf1`
  primary. The page, headline and captions stay light, which keeps the video
  readable on either kind of timeline. Page furniture uses the light tokens for
  the same reason: `#1b4ed8` has the contrast on white that `#346bf1` does not.
- **Nested corners step down.** A ring inside a panel needs a *smaller* radius
  than the panel, or the corners read as mismatched. Panels are 16–18, so the code
  ring is 12. Anything drawn at two places in the frame goes in one component
  (`CodeHighlight`) so the two cannot drift apart.
- **The end card is a logo and a handle.** Remy mark and wordmark, then the GitHub
  mark and `padamchopra/remy`. No tagline and no spelled-out URL: fifteen seconds
  of the app doing the thing has already said what it is, and an end card that has
  to be read is one nobody reads.
- **The strings are the app's.** "Remy is running here.", "Waiting for
  workbench", the whole pair dialog — copied from `web/src/components/Settings.tsx`
  and `PairRequest.tsx`, not rewritten. A video that says something the window
  does not is a video that has to be re-shot when the window changes.

## Add a device

`PairDevice` is the 15-second explainer for adding a device: your tailnet offers
the list, you press Pair, and somebody at the other device compares six digits
and allows it. 1920×1080, 30fps — sized for a timeline embed.

```sh
cd video && npm i
npx remotion studio            # preview, scrub, edit
npx remotion render PairDevice out/remy-add-a-device.mp4 --codec=h264 --crf=18
```

Renders are **not** committed. `docs/video/` is ignored, and so is `out/`: an
MP4 is a build artifact, and git keeps every version of a binary forever — five
committed cuts of this fifteen-second video came to 12.5 MB of history that
nothing can reclaim. Render it, post it, and keep the file outside the repo.

## How it is put together

| Path | What it is |
|---|---|
| `src/pair/PairDevice.tsx` | The six scenes, crossfaded by `TransitionSeries`. |
| `src/pair/scenes/` | One file per scene. Each is also registered on its own in `src/Root.tsx`, so you can open and trim it in the Studio. |
| `src/pair/parts/` | The app's surfaces at video scale — the window, a tailnet row, the waiting panel, the pair dialog, the seam link between two devices. |
| `tools/make-audio.mjs` | Synthesises the score and the three interface sounds. |
| `public/audio/` | Its output, committed as MP3. |

Two more things that are easy to break:

- **The two-window stage never moves.** Scenes 3 to 5 place both windows at the
  same coordinates and keep every row the same height, so a crossfade between them
  reads as one continuous take instead of a cut. **Retiming a scene means
  re-checking the cut frames** — a window that has started sliding while the
  previous scene still shows it stationary renders as a double image. `Ask` holds
  its move until frame 10 for exactly this reason.
- **Borders run hotter than the app's.** `--border` is white at 6%, which over
  `#111111` all but vanishes at 1.5px once H.264 has been through it. The video
  uses 7–10% so a card still has an edge. It is the one place the colours
  deliberately depart from the tokens.
- **Animate with `useCurrentFrame()`.** CSS transitions and Tailwind's
  `animate-*` do not render. Keep `interpolate()` calls inline in `style` so the
  Studio can keyframe them.
- **Fonts load in `src/Root.tsx`.** `sideEffects` in `package.json` lists CSS
  only, so a side-effect-only `import "./fonts"` gets tree-shaken and every scene
  falls back to the browser's serif.

## Sound

`tools/make-audio.mjs` writes all of it — nothing here is licensed from anywhere,
so the video carries no rights but yours. It is also cut to the picture in a way
a stock track cannot be: at 140 BPM six bars land on the frame the two devices
pair, which is the one moment the music has to agree with the picture; the drums
drop out through the bar where the codes are being compared.

```sh
node tools/make-audio.mjs      # writes public/audio/*.wav
                               # then convert to MP3 — the script prints how
```

It is deterministic, so re-running it without changing anything rewrites the same
bytes. The arrangement is the `PLAN` array: one row per bar, `level` scaling the
whole bar and the rest scaling a voice. Reach for `level` first — the per-voice
gains alone measure almost flat, because the pad-only opening is within a couple
of dB of the full band and the limiter then flattens what is left.

**Retiming the video means regenerating the score.** `BPM`, `DURATION` and `PLAN`
are all cut to a specific set of scene lengths; change the lengths and the music
lands nowhere in particular.

The score sits on the master composition in `PairDevice.tsx`; its fades are baked
into the file rather than driven by a volume curve. The three interface sounds
(`Sfx`) sit in the scenes on the frame each one belongs to, so a scene opened by
itself in the Studio still sounds right.

**Swapping in a licensed track:** replace `public/audio/score.mp3` and check the
level on `<Audio>` in `PairDevice.tsx`. The interface sounds are independent and
can stay.
