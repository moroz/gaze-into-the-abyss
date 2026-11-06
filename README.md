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
- **Music**: `public/music`, rendered from public-domain MIDI editions listed in `src/data/music.json`.
- **Credits**: `/credits`, generated from both data files.

## Adding an image

Use public-domain images only. Put the file in `src/assets/cosmos` and add an entry to
`src/data/cosmos.json`. The slideshow and the credits page pick it up from there.

## Changing the music

Use public-domain sources only, the MIDI edition as well as the composition, so the page needs no credit
line. Add or change an entry in `src/data/music.json`, then render:

```bash
uv run script/render_soundtrack.py
```

It needs FluidSynth, the FluidR3 GM soundfont (Debian: `fluid-soundfont-gm`), ffmpeg with libmp3lame, and
uv, which installs the Python packages from the script's inline metadata. The band, the detuning and the reverb live in the script, and every
track uses the same ones. Edit the script and render again rather than editing the MP3s.
