# Handover: rendering the trip as a 4K60 video for YouTube

State on 2026-11-07, on the `video-render` branch. Continue on the NVIDIA laptop (RTX 4060 Laptop beside Intel Arc).

## Goal

A "music for tripping" video for YouTube at 3840×2160, 60 fps, rendered from the site itself. **Visuals first: 30
minutes** (108,000 frames). The music playlist is decided later and muxed in afterwards. Attribution goes in the
video description, not on screen.

## Rights, already checked

- **Backgrounds** (`src/data/backgrounds.json`): 14 public domain (4 images, 10 videos) and 3 CC BY-SA videos (one 3.0,
  two 4.0). Nothing is NC, so monetising is fine. Because of the BY-SA loops, the video has to be shared alike: say
  "CC BY-SA 4.0" in the description. YouTube's own licence setting only offers Standard or CC BY, so the description
  carries it. If a video free of share-alike is wanted, leave those three out (`/credits` marks them).
- **Music** (for later): the five tracks are all public domain (the BY-SA bagpipe "Joy on the Pipes" was dropped from
  the site).

## Music, for later

The five tracks on the CDN come to 41:31 played once (6:04, 12:41, 14:39, 6:23, 1:45). They are 96 kbps MP3s, which is too thin for YouTube: re-render them from `sources/` with
`script/render_soundtrack.py` to WAV (it already makes `dry.wav` on the way; it needs a lossless output option).

## What was done

**The site now draws everything in one WebGL 2 canvas** (`src/scripts/stage.ts`), on the site as well as for the
render. Before, it was CSS-animated slides, `<video>` elements, a warp canvas per video and the overlay canvas,
composited by the browser; recording that needed a screenshot per frame and a video seek per frame. The measurements
that drove the change (4K, RTX 4060, headless Chrome):

| per frame | before | now |
| --- | --- | --- |
| seeking the `<video>`s | 349 ms | none: frames decoded ahead into JPEGs |
| getting the picture out | PNG screenshot ~540 ms, JPEG ~210 ms | readPixels of yuv420p, 21 ms |
| moving it to ffmpeg | base64 over CDP | POST as a Blob, overlapped with the next frame (an ArrayBuffer body took 344 ms, a Blob 50 ms) |
| encoding | x264 `slow` on the CPU | `hevc_nvenc`, ~90 fps at 4K on its own |
| **total** | ~440 ms (2.3 fps) | ~40 ms (**24–26 fps**) |

- The stage reproduces what the stylesheet did: the CSS filter chains as colour matrices (Filter Effects spec values,
  clamped between steps), the transitions' timing curves, bloom's zoom, blur (mipmap taps, approximate) and
  brightness, the image drift (now numeric poses; one of the six pairs interpolates slightly differently from CSS's
  matrix fallback), the trip's screen blend and breathing, the vignette's gradient and the dawn. A render at 20 s
  matched the old screenshot render of the same seed almost exactly.
- `slideshow.ts` keeps every random draw in its old order, so seeds replay the same backgrounds.
- `#render` mode: `FrameVideo` (`render-frames.ts`) replaces `<video>`; loads are awaited before the clock moves, so
  network speed cannot change the result; `__abyss.send()` reads the frame back and posts it.
- GPU: Chrome only reaches the NVIDIA card with PRIME offload variables, and only through `gl`/`egl`; Vulkan gives no
  WebGL 2 in headless Chrome. The renderer sets both and refuses any other GPU.
- ffmpeg: Homebrew's has no NVENC, `sudo` needs a password, and a static build from GitHub was refused by the
  permission classifier, so Debian's package is unpacked without root into `~/.local/opt/ffmpeg-debian/`.

See the README's "Rendering a video" for usage.

## Open

1. **Black flashes on the site**: fixed. A `<video>` wrapping round its loop briefly had no frame and the stage dropped
   the layer to black; it now shows the warp's last frame. The user confirmed no flashes after that. A review then
   hardened the stage (a throw no longer stops the loop, the source videos are full size under the canvas, images
   upload during the hold) and the renderer (a broken page or frame stops the run; params.json pins a resume).
2. The site on phones is untested since the rewrite: canvas at device pixel ratio up to 1.5, one extra full-screen
   pass per background compared with before.
3. Music: the lossless re-render above, then mux: `ffmpeg -i video.mp4 -i music.wav -c:v copy -c:a aac -b:a 384k`.
