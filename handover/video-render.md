# Handover: rendering the trip as a 4K60 video for YouTube

State on 2026-11-07, uncommitted in the working copy on top of `main` (`05f7209`). Nothing here has rendered a frame
yet. Continue on the NVIDIA laptop.

## Goal

A "music for tripping" video for YouTube at 3840×2160, 60 fps, rendered from the site itself. **Visuals first: 30
minutes** (108,000 frames). The music playlist is decided later and muxed in afterwards. Attribution goes in the
video description, not on screen, so every control and caption is hidden in the render.

## Rights, already checked

- **Backgrounds** (`src/data/backgrounds.json`): 14 public domain (4 images, 10 videos) and 3 CC BY-SA videos (one 3.0,
  two 4.0). Nothing is NC, so monetising is fine. Because of the BY-SA loops, the video has to be shared alike: say
  "CC BY-SA 4.0" in the description. YouTube's own licence setting only offers Standard or CC BY, so the description
  carries it. If a video free of share-alike is wanted, leave those three out (`/credits` marks them).
- **Music** (for later): of the six tracks only "Joy on the Pipes" (The Rock Piper) is BY-SA; the rest are public
  domain.

## Music, for later

The six tracks on the CDN come to 47:40 played once (6:04, 12:41, 14:39, 6:23, 6:09, 1:45), or 41:31 without the
bagpipes. They are 96 kbps MP3s, which is too thin for YouTube: re-render them from `sources/` with
`script/render_soundtrack.py` to WAV (it already makes `dry.wav` on the way; it needs a lossless output option).

## Approach: offline and frame-exact, not screen capture

Screen capture at 4K60 drops frames on any laptop GPU, and the shader work is heavy at full resolution. Instead, a
headless Chrome runs the built site on a fake clock that moves exactly 1/60 s per frame. Each frame is captured as a
PNG and piped into x264. A slow GPU only makes it take longer; the result is the same.

- **`script/render/clock.js`**, injected before the page's scripts, replaces `performance.now`, `Date.now`,
  `setTimeout`/`setInterval` and `requestAnimationFrame`. `window.__clock.step(ms)` fires the timers that fall due in
  order, runs one animation frame, and sets every CSS animation (`document.getAnimations()`) to its age on the fake
  clock. Videos never really play. `play()` and `pause()` and the `paused` getter are faked, and every video on screen
  (`.is-active`/`.is-leaving`) is seeked to its own time modulo its duration, waiting for `seeked`.
- **`#render`** (new, in `src/scripts/shader-canvas.ts`) lifts the overlay's 75% scale, its one-megapixel cap and its
  24 fps limit, so the trip draws every frame at full 4K. The video warp already draws at the device pixel ratio
  (capped at 1.5), so at `deviceScaleFactor: 1` it is full size without a change.
- **`script/render/bench.mjs`** serves as the benchmark and as the seed of the real renderer. It fast-forwards `SKIP`
  seconds without capturing (the first ~10 s are the black opening), then captures `SECONDS_` seconds and prints
  ms per frame for the step, the video seeks, the screenshot and the pipe to ffmpeg. It hides `.music`, `.hint`,
  `.fullscreen-toggle` and `.source-link`.

```bash
pnpm install && pnpm build && pnpm preview --port 4321 &
SKIP=60 SECONDS_=10 CHROME=/usr/bin/google-chrome \
  node script/render/bench.mjs "http://localhost:4321/#seed=abyss&render" bench.mp4 vulkan   # or: gl, egl
```

The last argument picks the ANGLE backend. The first thing it prints is the WebGL renderer: check it names the
NVIDIA card, not SwiftShader or llvmpipe. On Linux with NVIDIA, `vulkan` or `egl` is the likely one.

## What happened here (Iris Xe, 20 cores, 30 GB)

- `puppeteer-core` 24.10.0 added as a dev dependency; Chrome 154 is the system `google-chrome`.
- The one sanity run (`vulkan`, `SKIP=12`, one second of capture) found **no WebGL 2** under `--use-angle=vulkan`, so
  neither the overlay nor the video warp drew. Even so, **fast-forwarding 12 s took 248 s: 345 ms per step, with no
  capture and no GL work**. At that rate, stepping alone takes about 10 hours for 30 minutes, so find where it goes
  before anything else. The suspects are the per-frame video seeks (`step` awaits `seeked` for every video on screen,
  fast-forward included) and the `page.evaluate` round trip per step. The run was stopped before it captured a
  frame, and `gl` and `egl` were never tried. So there are no capture numbers yet. The shim does run against the page:
  timers and slides advance, though whether correctly is unchecked.

## Next

1. Get a renderer line naming the GPU on the laptop (try `egl` and `gl` if `vulkan` says "no WebGL 2"). Time one
   step with and without the seeks. Then run the 10 s benchmark and look at `bench.mp4`. Check that the
   frame moves smoothly, that the videos play at the right speed, and that the dawn lifts and slides change.
2. Fix what the shim gets wrong. The likely spots:
   - **Videos loading while paused.** The shim sets `preload="auto"` and turns `canplay` into `canplaythrough`. If a
     video never loads, the slideshow skips it after 60 fake seconds.
   - **Seeks.** Each frame seeks from a keyframe. If `seek` dominates, try advancing small steps, or extract the
     loops' frames with ffmpeg up front.
   - **The first frame of each CSS animation.** Its age starts the step it is first seen, so it may be one frame late.
3. From the numbers, estimate the full 30 minutes. The likely bottleneck is the PNG capture (CPU), not the GPU.
4. Turn the benchmark into the renderer:
   - Render in one-minute segments, each its own `.mp4`, so a crash resumes. Resuming fast-forwards at the same 1/60 s
     steps, because the shader's clock integrates its pace and clamps long steps.
   - Join them with the concat demuxer (`-c copy`).
   - Fade to black at the end.
   - Fix the seed (`#seed=abyss` so far) so it can be re-rendered.
   - Encoder settings: x264 `-preset slow -crf 14`, `yuv420p`, BT.709 tags. Expect about 15–20 GB for 30 minutes.
5. Commit with `jj commit`: the `#render` option, `puppeteer-core`, `script/render/` and a README section on rendering.
