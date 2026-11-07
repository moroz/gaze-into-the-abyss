# Handover: looping videos, credits beside the music, and a media CDN

State on 2026-11-07, merged into `main`. Six video loops (four of bison, two desert) play among the images from
the CloudFront CDN, with their credits beside the music. §3–§6 describe what was built.

## What you asked for

1. **Video backgrounds** among the images, chosen to evoke nostalgia.
2. **A playing video is the star.** Tried and reversed: dimming the overlay for video read as the trip stopping,
   and the trip should never stop. Videos run oversaturated instead (§4).
3. **Visual credits in the music caption area**, beside the play button.
4. **A dedicated CDN for media**, so changing imagery, video or music doesn't mean redeploying it.

## 1. Finding nostalgic, free footage

Footage may be public domain (PD, PDM, CC0) or CC BY, BY-SA, BY-NC or BY-NC-SA; NC is fine because the site is
non-commercial (README, "Adding an image or a video"). No ND: a loop adapts the work. Check each item, because a
collection's general status doesn't settle each file. CC items need `author` and `licence` in the schema (§3).

- **Open Beelden** (openbeelden.nl): Dutch archive incl. Polygoon newsreels, 1920s–80s: beaches, cities,
  fairs, traffic, skating. Mostly CC BY-SA, per item.
- **Europeana** (europeana.eu): European archives' newsreels, travel films and actualities; filter by rights.
- **Wikimedia Commons** video categories: archival film with a clear licence and author on every file.
- **Internet Archive** home-movie and amateur-film collections (Super 8, 16 mm scans): very nostalgic,
  licences vary by uploader.
- **Vimeo**, searched with a CC licence filter: some vintage film scans.
- Not usable: Pexels and Pixabay (own licences, not CC, and modern-looking), British Pathé and AP.

- **Prelinger Archives** (Internet Archive, `archive.org/details/prelinger`): 1940s–70s home movies,
  travelogues, industrial and educational films. City streets, drive-ins, fairs, highways, holidays. Many
  items carry the Public Domain Mark, but not all do, so read each item's licence field.
- **NASA archival film**: 16 mm Gemini and Apollo footage (Earth from orbit, splashdowns, launch pads)
  and Shuttle-era footage. Public domain unless marked.
  - images.nasa.gov has it under queries like "Apollo 16mm".
  - The NASA SVS archive is another source.
- **US National Archives** (catalog.archives.gov) and the **Library of Congress** National Screening Room:
  newsreels, government films and early 1900s actualities. US federal works are public domain. Watch for
  donated material with its own terms.
- **NOAA and US Fish & Wildlife** b-roll for wild animals and landscapes (public domain as federal works).
  It looks more contemporary than nostalgic, though the film look below can help.

To lean into nostalgia on footage that looks too clean, a film look could be added in `make_loop.sh` before
encoding:
- a gentle fade of contrast and saturation (`eq`, `colorbalance` toward warm highlights)
- grain (`noise=alls=8:allf=t`)
- slight gate weave (a tiny random `crop` shift per frame)
- a soft vignette (`vignette`)

Keep it subtle; the overlay and the page vignette add to it.

Clips that loop well:
- slow pans, aerials and time-lapses
- crowds and traffic
- water
- clips without a cut, since a cut inside a clip reads as a glitch on every loop

## 2. Making loops: `script/make_loop.sh`

```bash
script/make_loop.sh INPUT NAME [START] [LENGTH] [CROSSFADE] [HEIGHT]
script/make_loop.sh ~/Downloads/prelinger-reel.mp4 drive-in 12 30 2 1080
```

It takes LENGTH seconds from START and makes a silent loop LENGTH − CROSSFADE seconds long. The last
CROSSFADE seconds fade into the excerpt's opening, which ends on the frame the loop starts with. It writes
`media/NAME.av1.mp4` (SVT-AV1, CRF 38) and `media/NAME.h264.mp4` (x264, CRF 23, for browsers without
AV1). `media/` is git-ignored; `script/upload_media.sh` publishes it to the CDN (§6).

Options: `SPEED=4` plays the excerpt four times as fast (START and LENGTH stay in source seconds, CROSSFADE is
in loop seconds); `CROP=iw:ih-80:0:80` crops first, e.g. to drop a burnt-in timestamp; `ASSUME_BT709=1` retags
mislabelled colour.

It needs ffmpeg with `libsvtav1` and `libx264` (Homebrew's `ffmpeg` has both) and `bc`.

**Tested here** on NASA's "GOLD Resources: ISS Airglow" (`GSFC_20180124_m12825_ISS_Airglow`, city lights
under airglow). A 20 s excerpt at 720p became an 18 s loop: 3.0 MB as AV1 and 5.6 MB as H.264. The jump
from the last frame back to the first measured 7.3, the same as an ordinary moving frame-to-frame step in
that clip (median 6.7, maximum 15), so the seam is invisible. At 1080p expect roughly 2–2.5× those sizes.
It took about 90 seconds for both encodes on four cores; your Mac will be quicker.

## 3. Video in the site

- **Data.** The `cosmos` collection is now `backgrounds` (`src/data/backgrounds.json`). An entry has `image` *or*
  `video` (`{ av1, h264 }`, paths relative to the media origin), and every entry has `title`, `author`, `licence`,
  optional `licenceUrl`, and `sourceUrl`. `src/scripts/media.ts` prefixes video paths with `PUBLIC_MEDIA_ORIGIN`,
  defaulting to the CloudFront domain. `handover/videos.json` records where each loop came from and how it was cut.
- **Markup** (`Slideshow.astro`): a video slide is `<video muted playsinline loop preload="none">` holding the two
  URLs as data attributes. Every slide carries its credit as `data-credit`.
- **Loading** (`slideshow.ts`): `load()` now reports success. A video gets an AV1 `<source>` then an H.264 one and
  starts playing, muted and still invisible, because iOS buffers only a playing video; it is ready on
  `canplaythrough`, within 60 s. A background that fails (no source decodes, Low Power Mode refuses playback, an
  image fails to decode) is skipped for the next one. A video pauses once its leaving transition ends.
- **Reduced motion:** video slides are left out of the rotation.
- **Stacking:** `.slides` has `isolation: isolate`. It used to get its stacking context by accident from the hue
  animation's filter; without one, the active slide's `z-index` lifts it over the trip canvas.

## 4. Video colouring

The trip overlay always runs at full strength. Instead, each video's `overlay` field picks its colouring:

- `calm` (the default for video): saturation breathes between 1.8× and 2.6× over 40 s, with a touch more
  contrast. Oversaturated old footage under the trip looks delightfully uncanny.
- `psychedelic` (the default for images; set on the Swan Lake Flats bison): the 180 s hue drift, at 2.2×
  saturation for video against the images' 1.3×.
- `hue-cycle` (the bloodybelly comb jelly): a heavy cycle, once round the colour wheel every 12 s at 2.4×.

The hue drift now runs on each picture from one shared `--hue-delay`, so it stays in step across slides.

Each video also draws through a WebGL 2 canvas (`src/scripts/video-warp.ts`) that bends the footage itself: a slow
layered ripple, a breathing swell from the centre, and a red–blue chromatic split. Each time a video comes on screen
the slideshow picks one effect on top, from the seeded `video effects` stream (`#effect=` forces one):

- `ripple`: the base warp alone.
- `kaleidoscope`: the footage folded into six mirrored wedges that slowly turn.
- `slit-scan`: each row a slightly different moment, from 32 frames of history at 384×216 (about 1.5 s, 10 MB of
  video memory, allocated the first time it is used). It shows on moving footage; on a still time-lapse it is
  close to `ripple`.
- `echo`: each frame mixed 14% into the last, which is zoomed, turned and hue-shifted, so motion leaves rainbow
  afterimages. Two frame buffers at canvas size.
- `thermal`: brightness mapped onto a cycling neon palette.

The `<video crossorigin>` stays underneath; the canvas removes itself if WebGL 2, its context or the frames are
unavailable. The candidates were tried out first in a demo page (Abyss Effect Lab) before these five were chosen,
alongside the `moire` overlay scene.

## 5. Credits beside the music

The slideshow dispatches `abyss:background` with the arriving slide's credit. `Soundtrack.astro` shows it in a
`.now-showing` caption above `.now-playing`: the title links to the source, then the author and the licence (linked
when it has a URL). Both captions fade with the controls. `/credits` lists every background; a video shows its
frame at 1 s as the thumbnail.

## 6. A media CDN

**Goal:** media lives at its own origin, so changing images, videos or music never redeploys the site, and
deploys stay small. The music alone is 28 MB in `public/music`; the images are 6 MB in `src/assets/cosmos`.

**Built: CloudFront in front of a private S3 bucket**, on the default domain, in the `medic` AWS account
(eu-central-1). Pulumi in `infra/` defines it; state lives in `s3://gaze-into-the-abyss-pulumi-state-eu-central-1/state`,
and the stack's secrets passphrase is age-encrypted in `infra/mise.toml`.

- Origin: `https://d19iphx0l37kqa.cloudfront.net` (distribution `E2L5CTKPND5E10`)
- Bucket: `gaze-into-the-abyss-media-f840ac64f80b9dcb6f47926108`, readable only through CloudFront
  (Origin Access Control); a direct S3 request gets 403, and so does a missing key.
- Cache policy `CachingOptimized`, which honours the objects' own `Cache-Control`. A response headers policy of
  our own, `media-cors`, sends `Access-Control-Allow-Origin: *` whatever the request headers, so WebGL can read
  video frames (§4). AWS's `Managed-SimpleCORS` does not do: it skips requests carrying `cache-control` or
  `priority`, which browsers add to every media request.

```bash
cd infra && aws-vault exec medic -- mise exec -- pulumi up
```

**Layout and caching:** `script/upload_media.sh DIR FILE...` uploads each file as
`DIR/<name>.<first 12 hex of sha256>.<rest>`, e.g. `videos/drive-in.3f9a2c1e4b7d.av1.mp4`, with
`Cache-Control: public, max-age=31536000, immutable` set on the S3 object. The same bytes always get the same
URL, an existing key is never overwritten, and a new upload is simply a new URL in the data files. It prints
`file<TAB>url` per file.

```bash
aws-vault exec medic -- script/upload_media.sh videos media/drive-in.av1.mp4 media/drive-in.h264.mp4
```

**Images lose Astro's processing once they're off-site.** Today `getImage` builds the 1280–3840 px WebP set
at build time. Either:
- keep the few images in the repo as now and move only video and music, which is the bulk; or
- add a script that generates the widths and uploads them, with the data file listing the URLs. An image
  CDN with on-the-fly resizing (Cloudflare Images, Bunny Optimizer) would also do.

Start with the first option.

**Wiring:**
- Add `PUBLIC_MEDIA_ORIGIN` (in `astro.config.mjs` or a Netlify environment variable). Data entries hold
  paths relative to it, and components prefix it.
- `script/make_loop.sh` writes to the git-ignored `media/` folder; `script/render_soundtrack.py` still
  writes to `public/music` and should follow. `script/upload_media.sh` publishes from there.
- Delete the MP3s from `public/music` once they're served from the CDN.

**History.** The MP3s, OGG sources and images already committed stay in git history. If repo size matters,
rewriting history (`git filter-repo`) is the only way to shrink clones, and it is disruptive. Probably not
worth it for a personal project.

## Not committed

The encoded loops live in the git-ignored `media/` folder and on the CDN. To rebuild one, download its `file` from
`handover/videos.json` and rerun `make_loop.sh` with its `loop` settings, then `upload_media.sh videos …`. The
same bytes give the same URL.

`make_loop.sh`'s crossfade leaves a residual step of under one grey level at the loop seam. A frame-exact
blend removes it but moves a slightly larger step two frames earlier; it was not worth pursuing, since it is
invisible.
