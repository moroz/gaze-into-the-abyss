# Handover: Gaze into the Abyss

State on 2026-11-06, written to continue on a machine with full internet access.

## Where things stand

- `main` (`74ad35c`) is the deployed site: seven NASA images, three shader scenes (liquid kaleidoscope,
  Julia bloom, Kali nebula), two tracks (*Aase's Death*, Tchaikovsky's Violin Concerto I), the pause/play
  symbol, the full-screen button and the "Click on the abyss" prompt.
- `wip/music-and-instruments` (this branch) adds only groundwork for more music, and nothing on the page
  changes yet:
  - `src/content.config.ts`: a track may give `midi` (a direct `.mid` URL) instead of `sourceZip`, but not
    both, and may list `parts`.
  - `script/render_soundtrack.py`: reads `midi` or `sourceZip`. It maps tracks by the `parts` list when the
    MIDI's track names are useless, and refuses a part list whose length doesn't match the playing tracks
    or that names a part with no band member. It also adds `corni` (one horn track) and a `triangle` band
    member on GM *tinkle bell*.
  - `handover/candidate-pieces.json`: six extra pieces I checked and mapped (below). None of them is in
    `src/data/music.json`; copy in the ones you pick.

`astro check` reports 0 errors, warnings and hints, and `npm run build` passes on this branch. Rerendering
reproduces the two committed MP3s byte for byte.

## To do

### 1. Pick the pieces

You were going to choose them, possibly from the University of Arizona MIDI library
(`http://midi.music.arizona.edu/search.php`). I couldn't reach it: it serves only plain HTTP, and its HTTPS
certificate is for another host.

**Check each file's licence before using it.** The composition can be public domain while a sequenced
MIDI file is the sequencer's own work and copyrighted. The site has to stay public domain throughout (the
README says so) so that it needs no credit line, so only use files whose page says public domain or CC0,
or that come from a public-domain edition.

The candidates I already checked are all public-domain Mutopia editions, with parts mapped in
`handover/candidate-pieces.json`:

| id | Piece | Slowdown | Notes |
|---|---|---|---|
| `allegretto` | Beethoven, Symphony 7, II. Allegretto | 0.6 | ~12 min; horns labelled "english horn" in the MIDI |
| `canzonetta` | Tchaikovsky, Violin Concerto, II. Canzonetta | 0.75 | ~8 min; solo on horn |
| `lento` | Dvořák, "American" Quartet, II. Lento | 0.75 | ~7 min; unnamed tracks, parts listed |
| `anitra` | Grieg, *Anitra's Dance* | 0.6 | ~3 min; adds the triangle |
| `finale` | Tchaikovsky, Violin Concerto, III. Finale | 0.7 | ~13 min; solo on horn |
| `american` | Dvořák, "American" Quartet, I. Allegro | 0.6 | ~10 min; unnamed tracks, parts listed |

Each track is about 0.7 MB per minute at 96 kbps, so six more add roughly 40 MB to the repo.

To add a piece:

1. Add an entry to `src/data/music.json` with the next `position`.
2. Run the script once to see whether the MIDI's track names map onto the band. It stops and names the
   track if not; then add `parts` in track order (look at each track's GM program and pitch range).
3. Render (see **Rendering** below).
4. Add the edition to `/credits`; that happens automatically from the JSON.

### 2. Revise the instruments

You found some GM sounds machine-like and the percussive ones more realistic. The band lives in `BAND`
and `GENERAL_MIDI` at the top of `script/render_soundtrack.py`, and every track uses it.

- **Within FluidR3:** the sustained wind and synth patches are the weak ones: ocarina, shakuhachi, pan
  flute, church organ, choir and the pads. The struck and plucked ones hold up: celesta, vibraphone,
  kalimba, harp, timpani and taiko, and also untried ones like marimba (12), glockenspiel (9), tubular bells
  (14), dulcimer (15) and steel drums (114). A band made mostly of mallets and plucks would play to the
  soundfont's strengths.
- **A better soundfont.** Candidates to evaluate, but check each licence yourself first:
  - *MuseScore General* (MIT at the time I knew it)
  - *GeneralUser GS* (permissive licence)
  - *VSCO 2 Community Edition* (CC0 orchestral samples, but SFZ, so it needs `sfizz` rather than FluidSynth)

  Prefer CC0, public domain or MIT so the page still needs no credit. `SOUNDFONT` in the script is the
  only path to change for an `.sf2`.
- **Less mechanical playback:** constant velocities and grid-perfect timing are part of the machine feel.
  Cheap fixes inside `recast()`:
  - a few milliseconds of seeded random timing jitter
  - ±10% velocity jitter
  - CC11 expression swells on the sustained voices

  Seed the randomness so renders stay reproducible.

### 3. Shuffle the playlist

Wanted: a random piece first on every visit, then a shuffled order, reshuffled after each full pass and
never the same piece twice in a row across the boundary. Only `src/scripts/soundtrack.ts` changes:

- Keep the single `<audio>` element and swap its `src`. iPadOS grants playback permission per element,
  so a second element would be blocked between tracks.
- Replace the `track` index with a queue: `queue = shuffle(tracks)`. When the queue empties, reshuffle,
  and if the new first item equals the one that just played, swap it with the second.
- `Soundtrack.astro` renders `src={paths[0]}` and `preload="auto"` for the first track. Either pick the
  first track in the script before the element loads (set `audio.src` at startup and drop the
  server-rendered `src`), or accept that the browser preloads track 1 needlessly.
- `prefetchNext` should fetch the next item in the queue.

### 4. Raise the visuals' opacity

In `src/components/Trip.astro`: `.trip` has `opacity: .5`, and `@keyframes breathe` goes from `.3` to
`.7`. The request was "higher"; try `.75` with `.55` → `.9`, and judge it over the brightest images
(Galaxy Center, Tarantula).

## Rendering

```bash
uv run script/render_soundtrack.py
```

It needs:
- FluidSynth and the FluidR3 GM soundfont (Debian/Ubuntu: `fluid-soundfont-gm`; macOS: `brew install
  fluid-synth` and download `FluidR3_GM.sf2`, then point `SOUNDFONT` at it)
- ffmpeg with libmp3lame
- uv, which installs `mido` and `numpy` from the script's inline metadata

It renders every track in `src/data/music.json`, which takes about a minute per 10 minutes of music.
Output is deterministic: the reverb's noise is seeded, so an unchanged track comes out byte-identical,
and `git status` shows only the tracks you actually changed.

## Checking the site

```bash
npm install
npx astro check
npm run build
npx astro preview
```

What I verified in headless Chromium, and what to retest after changes, especially on the iPad:

- **Autoplay blocked:** the prompt appears, and a tap or click starts the music. The page listens for
  `click`, because iPadOS doesn't count a touch's `pointerdown` as permission to play.
- **A play request that hangs**, as Brave on iPad does: a watchdog treats "track loaded but silent after
  2 s" as blocked and shows the prompt.
- **The browser pausing the music on its own:** the prompt comes back.
- **Pause** is instant.
- **Tracks hand over and loop.**
- **The full-screen button** enters and leaves full screen and hides where unsupported. Brave on iPad may
  hide it, since WebKit-based browsers only expose full screen if the app enables it.

## Traps

- `getCollection` doesn't keep the JSON's order; everything sorts by `position` (`src/scripts/by-position.ts`).
- Astro caches content collections in `.astro/`. If a data change seems ignored, `rm -rf .astro` and rebuild.
- Image `sizes` is `118vw` because the slow drift zooms images up to 1.18×.
- Pin npm versions exactly, to releases at least two weeks old (Astro is on 7.4.2 for that reason).
- Netlify: build `npm run build`, publish `dist`, `NODE_VERSION` ≥ 22.23.4 (Astro 7's minimum).
