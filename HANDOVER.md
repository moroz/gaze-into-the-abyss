# Handover: looping videos, credits beside the music, and a media CDN

State on 2026-11-07. `main` is at `e1fdd6e`: seeded randomness (`#seed=`), random image and scene order,
random transitions, and the opening from black. This branch, `wip/videos`, adds only
`script/make_loop.sh` and this file. Nothing on the site changes yet.

## What you asked for

1. **Video backgrounds** among the images, chosen to evoke nostalgia.
2. **A playing video is the star:** the psychedelic overlay tones down while it plays.
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

It needs ffmpeg with `libsvtav1` and `libx264` (Homebrew's `ffmpeg` has both) and `bc`.

**Tested here** on NASA's "GOLD Resources: ISS Airglow" (`GSFC_20180124_m12825_ISS_Airglow`, city lights
under airglow). A 20 s excerpt at 720p became an 18 s loop: 3.0 MB as AV1 and 5.6 MB as H.264. The jump
from the last frame back to the first measured 7.3, the same as an ordinary moving frame-to-frame step in
that clip (median 6.7, maximum 15), so the seam is invisible. At 1080p expect roughly 2–2.5× those sizes.
It took about 90 seconds for both encodes on four cores; your Mac will be quicker.

## 3. Wiring video into the site (not started)

Planned design:

- **Data.** Rename the `cosmos` collection to `backgrounds` (or keep the name) and let an entry be an image
  *or* a video:
  - `image: image().optional()`
  - `video: z.object({ av1: z.string(), h264: z.string() }).optional()` holding CDN URLs
  - a `.refine` requiring exactly one of them
  - `author` and `licence` (with its URL), which CC credit needs
  - generalise `nasaId` into a `sourceUrl`, since not everything comes from NASA
- **Markup** (`Slideshow.astro`). A video slide renders
  `<video muted playsinline loop preload="none" data-av1 data-h264>`. Muted, inline video autoplays
  everywhere, iOS included.
- **Loading** (`slideshow.ts`). `load()` already gates every change on the next background being ready. For
  a video:
  - add `<source>` elements, AV1 first with `type='video/mp4; codecs="av01.0.08M.08"'`, then H.264 with
    `codecs="avc1.640029"`
  - call `video.load()` and resolve on `canplaythrough`
  - make `load` report failure, and add a patience timeout (say 60 s). Then a background that never loads
    is skipped instead of stalling the slideshow; currently a failed image decode simply shows it anyway.

  The black openings and dip-to-black transitions cover the buffering, as you said.
- **Playback.** `play()` in `show()`. Pause the leaving slide when its transition ends, so off-screen
  videos don't decode.
- **Reduced motion.** Under `prefers-reduced-motion`, leave video entries out of the shuffle; the drift and
  hue animations already stop there.
- **Randomness.** No change needed: videos join the same `slides` stream, so `#seed=` covers them.

## 4. The video as the star

When a video slide becomes active, set `data-background="video"` on `.abyss` (clear it for images). Then
CSS:

- **Overlay.** `.abyss[data-background="video"] .trip` drops from `.75` (breathing `.45`–`1`) to about
  `.12`–`.2`, with a slow transition (3–4 s) so the change itself is a gentle fade. Consider pausing its
  `breathe` animation too.
- **Hue drift.** Turn off `.slides`' hue rotation for video slides. Old footage should keep its own colours,
  and a hue shift fights the nostalgia. Images can keep it.
- **Image filter.** Lighten the `brightness(.8) saturate(1.3) contrast(1.05)` filter (or drop it) for video.

A further option is for the shader scheduler to prefer its calmest scene, `liquid` at low exposure, during
video, via a flag `sceneSchedule` reads. Start with opacity alone and judge.

## 5. Visual credits beside the music

`Soundtrack.astro` already has the caption next to the play button:
`<p class="now-playing">` with `.now-title`, `.now-work` and `.now-edition`, filled from the audio element's
`data-credits`, and shown while the controls show. Add a second line, e.g.
`<p class="now-showing"><strong class="now-showing-title"></strong> <a class="now-showing-credit"></a></p>`:

- `slideshow.ts` dispatches an `abyss:background` event carrying the entry's title, credit and source URL
  whenever a slide arrives. Put them on each `.slide` as data attributes in `Slideshow.astro`.
- A small listener fills the line. Style it like `.now-playing` so both fade with the controls.
- `/credits` keeps listing everything; for videos, show a poster frame or a `preload="metadata"` mini
  video instead of `<Image>`.

## 6. A media CDN

**Goal:** media lives at its own origin, so changing images, videos or music never redeploys the site, and
deploys stay small. The music alone is 28 MB in `public/music`; the images are 6 MB in `src/assets/cosmos`.

**Built: CloudFront in front of a private S3 bucket**, on the default domain, in the `medic` AWS account
(eu-central-1). Pulumi in `infra/` defines it; state lives in `s3://gaze-into-the-abyss-pulumi-state-eu-central-1/state`,
and the stack's secrets passphrase is age-encrypted in `infra/mise.toml`.

- Origin: `https://d19iphx0l37kqa.cloudfront.net` (distribution `E2L5CTKPND5E10`)
- Bucket: `gaze-into-the-abyss-media-f840ac64f80b9dcb6f47926108`, readable only through CloudFront
  (Origin Access Control); a direct S3 request gets 403, and so does a missing key.
- Cache policy `CachingOptimized`, which honours the objects' own `Cache-Control`; response headers policy
  `SimpleCORS`, so WebGL or Web Audio can read media later.

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

The test loops (`public/videos/airglow-test.*`) and the source clip stayed on the cloud machine. Rerun the
script on your Mac to reproduce them.
