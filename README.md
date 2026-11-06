# Gaze into the Abyss

Cosmic imagery, psychedelic shaders and slowed-down Romantic music, full screen. An Astro site with no
server: `npm run build` writes a static site to `dist/`.

```bash
npm install
npm run dev
```

## What it is made of

- **Imagery**: public-domain NASA images in `src/assets/cosmos`, listed with their credits in
  `src/data/cosmos.json`. Astro builds a responsive set of sizes for each one.
- **Visuals**: a WebGL fragment shader, `src/scripts/psychedelia.frag`, cross-fading between a liquid
  kaleidoscope, a Kali-set nebula folded into eight mirrors, a three-mirror kaleidoscope that tiles the screen, and the
  Mandelbrot boundary with its Julia sets in six mirrors, over the imagery.
- **Music**: `public/music`, rendered from the MIDI editions listed in `src/data/music.json`. Beside the play
  button, while the controls show, a caption says what is playing and whose edition it is.
- **Credits**: `/credits`, generated from both data files.

## Adding an image

Use public-domain images only. Put the file in `src/assets/cosmos` and add an entry to
`src/data/cosmos.json`. The slideshow and the credits page pick it up from there.

## Changing the music

The composition must be public domain. The MIDI edition must be public domain or free to use with credit; the
credit comes from the entry's `edition` and `editionUrl` and is shown in that caption and at `/credits`. A share-alike
edition makes its rendering share-alike too, so say so in `edition`. Add or change an entry in
`src/data/music.json` (`firstBar` and `lastBar` cut an excerpt), then render:

```bash
uv run script/render_soundtrack.py
```

It needs FluidSynth, the FluidR3 GM soundfont (Debian: `fluid-soundfont-gm`), ffmpeg with libmp3lame, and
uv, which installs the Python packages from the script's inline metadata. Each track plays on the instruments its
MIDI names, slowed, through the same saturation and long reverb, which live in the script. Edit the script and
render again rather than editing the MP3s.
