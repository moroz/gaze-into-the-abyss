# Gaze into the Abyss

Cosmic imagery, psychedelic shaders and slowed-down Romantic music, full screen. An Astro site with no
server: `pnpm build` writes a static site to `dist/`.

```bash
pnpm install
pnpm dev
```

## What it is made of

- **Imagery**: public-domain NASA images in `src/assets/cosmos`, listed with their credits in
  `src/data/cosmos.json`. Astro builds a responsive set of sizes for each one. They play in a fresh random order on
  every visit, each for a random stretch with a random drift, changing by a crossfade, a dip through black, a bloom
  or a slow dissolve.
- **Visuals**: a WebGL fragment shader, `src/scripts/psychedelia.frag`, with four scenes over the imagery: a liquid
  kaleidoscope (`liquid`), a Kali-set nebula folded into eight mirrors (`nebula`), a three-mirror kaleidoscope that
  tiles the screen (`lattice`), and the Mandelbrot boundary with its Julia sets in six mirrors (`fractal`).
  `src/scripts/scene-schedule.ts` plays them in random order for random lengths, changing by a crossfade, a bloom from
  the centre, an ink-like dissolve or a petal wipe.
- **Opening**: everything starts in total blackness, which lifts once the first image has loaded.
- **Music**: `public/music`, rendered from the recordings and MIDI editions listed in `src/data/music.json`. Beside the play
  button, while the controls show, a caption says what is playing and whose edition it is.
- **Credits**: `/credits`, generated from both data files.
- **Links**: `#scene=<name>` opens on that visual scene, `#t=<seconds>` sets the moment within the scenes'
  animation, and `#track=<id>` starts the music on that `music.json` entry, e.g. `/#scene=liquid&track=new-world-finale`.

## Adding an image

Use public-domain images only. Put the file in `src/assets/cosmos` and add an entry to
`src/data/cosmos.json`. The slideshow and the credits page pick it up from there.

## Changing the music

The composition must be public domain. The recording or MIDI edition must be public domain or free to use with
credit; the credit comes from the entry's `edition` and `editionUrl` and is shown in that caption and at
`/credits`. A share-alike edition makes its rendering share-alike too, so say so in `edition`. Add or change an
entry in `src/data/music.json` (`firstBar` and `lastBar` cut an excerpt from a MIDI file), then render:

```bash
uv run script/render_soundtrack.py
```

The script reads each source from `sources/` under the entry's `member` name, downloading it from `source` when it
is missing (a zip's `member` is the file taken from it), and stops if the file's SHA-256 differs from the entry's
`sha256`. Commit a new file there with its checksum. The files keep their editions' licences, credited at
`/credits`.

It needs FluidSynth, the FluidR3 GM soundfont (Debian: `fluid-soundfont-gm`), ffmpeg with libmp3lame, and uv, which
installs the Python packages from the script's inline metadata. A MIDI file plays on the instruments it names,
slowed; a recording is slowed keeping its pitch. Both go through the same saturation and long reverb, which live in
the script. Edit the script and render again rather than editing the MP3s.
