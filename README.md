# Gaze into the Abyss

Cosmic imagery, psychedelic shaders and slowed-down Romantic music, full screen. An Astro site with no
server: `pnpm build` writes a static site to `dist/`.

```bash
pnpm install
pnpm dev
```

## What it is made of

- **Imagery**: NASA images and looping, oversaturated, warped videos of herds, birds, deep-sea jellies, lava, aurora
  and desert, all served from a CloudFront CDN (`infra/`) and listed with their credits in
  `src/data/backgrounds.json`. Each image comes in a responsive set of widths. They play in a fresh random order on every visit, each for a random
  stretch, changing by a crossfade, a dip through black, a bloom or a slow dissolve; the one on screen is credited
  beside the music.
- **Visuals**: a WebGL fragment shader, `src/scripts/psychedelia.frag`, with four scenes over the imagery: a liquid
  kaleidoscope (`liquid`), a Kali-set nebula folded into eight mirrors (`nebula`), a three-mirror kaleidoscope that
  tiles the screen (`lattice`), and two drifting sets of rings interfering (`moire`). Their clock runs at a pace that
  wanders between about half and one and a half times over minutes.
  `src/scripts/scene-schedule.ts` plays them in random order for random lengths, changing by a crossfade, a bloom from
  the centre, an ink-like dissolve or a petal wipe.
- **Opening**: everything starts in total blackness, which lifts once the first background has loaded, or after 7 s.
- **Drawing**: all of it is drawn in one WebGL 2 canvas by `src/scripts/stage.ts`: the backgrounds (videos through
  the warp in `video-warp.ts`, images with their drift), their colouring and transitions, the trip overlay screened
  over them (`trip.ts`), the vignette and the opening veil. `slideshow.ts` only decides what shows when. A browser
  without WebGL 2 gets the first image, still.
- **Music**: MP3s on the media CDN, rendered from the recordings and MIDI editions listed in `src/data/music.json`. Beside the play
  button, while the controls show, a caption says what is playing and whose edition it is.
- **Credits**: `/credits`, generated from both data files.
- **Links**: `#seed=<anything>` replays a visit: every random choice (the image and scene order, holds, drifts,
  transitions, the music shuffle) comes from that seed, and without one the page picks a fresh seed and logs it to the
  console. `#scene=<name>` opens on that visual scene, `#t=<seconds>` sets the moment within the scenes' animation, and
  `#track=<id>` starts the music on that `music.json` entry, e.g. `/#seed=abyss&scene=liquid&track=new-world-finale`.
  `#effect=<name>` holds every video to one effect: `ripple`, `kaleidoscope`, `slit-scan`, `echo` or `thermal`.

## Adding an image or a video

Images and video backgrounds must be public domain (PD, PDM, CC0) or Creative Commons: CC BY, BY-SA, BY-NC
or BY-NC-SA. NC is fine because the site is non-commercial; drop those items if that ever changes. Never ND
for video: a loop is an excerpt with a crossfade, so it adapts the work. Check the licence on each item, not
the collection. Credit the title, author, source and licence; a share-alike item makes its loop share-alike
too, and `/credits` says so beside each one.

For an image, add an entry to `src/data/backgrounds.json` without `image`, then publish the file, named after the
entry's id; the script makes the WebP widths and a thumbnail, uploads them with the original, and fills in `image`:

```bash
aws-vault exec medic -- node script/publish_images.mjs ~/Pictures/orion.webp
```

For a video, cut a loop
and upload it, then add an entry whose `video` holds the two printed paths (without the origin):

```bash
script/make_loop.sh ~/Downloads/clip.mp4 NAME START LENGTH CROSSFADE HEIGHT   # writes media/NAME.{av1,h264}.mp4
aws-vault exec medic -- script/upload_media.sh videos media/NAME.av1.mp4 media/NAME.h264.mp4
```

A video's `overlay` is `calm` (breathing oversaturation, the default), `psychedelic` (the slow hue drift) or
`hue-cycle` (once round the colour wheel every 12 s). Its optional `effects` lists the warp effects that suit it,
e.g. `["kaleidoscope"]`; without it, each showing draws from all five. Its optional `distortion` (default 1) sets how
hard the footage is bent: lower for a landscape that should stay true, higher for a jelly. Each showing varies it a
little, and gives the slide its own pace for every colour cycle and warp. The slideshow
and the credits page pick everything up from the data file.

## Changing the music

The composition must be public domain. The recording or MIDI edition must be public domain or free to use with
credit; the credit comes from the entry's `edition` and `editionUrl` and is shown in that caption and at
`/credits`. A share-alike edition makes its rendering share-alike too, so say so in `edition`. Add or change an
entry in `src/data/music.json` (`firstBar` and `lastBar` cut an excerpt from a MIDI file), then render:

```bash
uv run script/render_soundtrack.py [ID...]                            # writes media/music/<file>
aws-vault exec medic -- script/upload_media.sh music media/music/NAME.mp3
```

Put the printed path (without the origin) in the entry's `path`; a re-rendered track gets a new path.

The script reads each source from `sources/` under the entry's `member` name, downloading it from `source` when it
is missing (a zip's `member` is the file taken from it), and stops if the file's SHA-256 differs from the entry's
`sha256`. A new source stays out of git (`sources/` is ignored; the four older ones are tracked): its `source` URL and
`sha256` are enough to fetch and verify it again. The files keep their editions' licences, credited at
`/credits`.

It needs FluidSynth, the FluidR3 GM soundfont (Debian: `fluid-soundfont-gm`), ffmpeg with libmp3lame, and uv, which
installs the Python packages from the script's inline metadata. A MIDI file plays on the instruments it names,
slowed; a recording is slowed keeping its pitch. Both go through the same saturation and long reverb, which live in
the script. Edit the script and render again rather than editing the MP3s.

## Rendering a video

`script/render/render.mjs` records the site as a video, frame-exact, for YouTube: 3840×2160 at 60 fps by default.
A headless Chrome runs the built site in `#render` mode on a clock that moves exactly one frame per step
(`script/render/clock.js`). The backgrounds play from frames decoded ahead of time (into the git-ignored
`media/render-frames/`), each frame is converted to yuv420p on the GPU and posted back, and ffmpeg encodes it with
NVENC (HEVC). A slow machine only renders more slowly; the video comes out the same.

```bash
pnpm build
node script/render/render.mjs ~/Videos/abyss-render --minutes 30 --seed abyss        # the whole video
node script/render/render.mjs ~/Videos/abyss-render --clip --start 20 --seconds 10   # one clip, with timings
```

- It renders in one-minute segments (`<out>/segments/`) and resumes after a crash at the first one missing,
  stepping through the rendered part to get back to the same moment. The last segment fades to black, and the
  segments are joined into `<out>/abyss_<seed>_<minutes>m.mp4`. No audio: the music is muxed in afterwards.
- It refuses to run unless WebGL names the NVIDIA GPU (`--any-gpu` allows any). On a laptop with two GPUs it sets the
  PRIME offload variables for Chrome and uses ANGLE over EGL; headless Chrome gets no WebGL 2 from Vulkan.
- It needs an ffmpeg with NVENC. Homebrew's has none; Debian's has, and is used from `/usr/bin/ffmpeg` or from
  `~/.local/opt/ffmpeg-debian/root/usr/bin/ffmpeg` (`apt-get download ffmpeg && dpkg -x ffmpeg_*.deb root` there,
  no root needed, as the libraries come with the system). `FFMPEG=` picks another; `--encoder libx264` encodes on
  the CPU instead, much more slowly.
- On an RTX 4060 laptop it renders 4K60 at about 24 fps, so 30 minutes take a little over an hour. Most of each frame
  goes to reading it back from the GPU and uploading it from the page.
- Attribution goes in the video's description, not on screen. With the CC BY-SA loops in, the video is CC BY-SA 4.0
  too; `/credits` marks them.

