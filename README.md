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
- **Visuals**: a WebGL fragment shader, `src/scripts/psychedelia.frag`, with five scenes over the imagery: a liquid
  kaleidoscope (`liquid`), a Kali-set nebula folded into eight mirrors (`nebula`), a three-mirror kaleidoscope that
  tiles the screen (`lattice`), the Mandelbrot boundary with its Julia sets in six mirrors (`fractal`), and two
  drifting sets of rings interfering (`moire`).
  `src/scripts/scene-schedule.ts` plays them in random order for random lengths, changing by a crossfade, a bloom from
  the centre, an ink-like dissolve or a petal wipe.
- **Opening**: everything starts in total blackness, which lifts once the first background has loaded, or after 7 s.
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
e.g. `["kaleidoscope"]`; without it, each showing draws from all five. The slideshow
and the credits page pick everything up from the data file.

## Changing the music

The composition must be public domain. The recording or MIDI edition must be public domain or free to use with
credit; the credit comes from the entry's `edition` and `editionUrl` and is shown in that caption and at
`/credits`. A share-alike edition makes its rendering share-alike too, so say so in `edition`. Add or change an
entry in `src/data/music.json` (`firstBar` and `lastBar` cut an excerpt from a MIDI file), then render:

```bash
uv run script/render_soundtrack.py                                    # writes media/music/<file>
aws-vault exec medic -- script/upload_media.sh music media/music/NAME.mp3
```

Put the printed path (without the origin) in the entry's `path`; a re-rendered track gets a new path.

The script reads each source from `sources/` under the entry's `member` name, downloading it from `source` when it
is missing (a zip's `member` is the file taken from it), and stops if the file's SHA-256 differs from the entry's
`sha256`. Commit a new file there with its checksum. The files keep their editions' licences, credited at
`/credits`.

It needs FluidSynth, the FluidR3 GM soundfont (Debian: `fluid-soundfont-gm`), ffmpeg with libmp3lame, and uv, which
installs the Python packages from the script's inline metadata. A MIDI file plays on the instruments it names,
slowed; a recording is slowed keeping its pitch. Both go through the same saturation and long reverb, which live in
the script. Edit the script and render again rather than editing the MP3s.
