#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mido", "numpy"]
# ///
"""The soundtrack for the rendered video: Dvořák's Symphony No. 9 "From the New World", all four movements of the
Musopen recording (public domain, on Wikimedia Commons), slowed to fill the video and put through the site's
saturation and long reverb (script/render_soundtrack.py), each movement's reverb tail running into the pause before
the next. Writes lossless FLAC at 48 kHz.

    uv run script/render/symphony.py ~/Videos/abyss-render/new-world.flac [--minutes 60] [--ends-early 10]

The slowdown is whatever makes the symphony end --ends-early seconds before the video does (about 0.71 for an hour).
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import render_soundtrack as soundtrack  # noqa: E402

COMMONS = "https://upload.wikimedia.org/wikipedia/commons"
NAME = "Antonin_Dvorak_-_symphony_no._9_in_e_minor_%27from_the_new_world%27%2C_op._95_-_"
MOVEMENTS = [
    ("dvorak-new-world-i-musopen.ogg", f"{COMMONS}/5/5c/{NAME}i._adagio_-_allegro_molto.ogg", "dbcacaba09c6f84e4ff3890894caacb080aee4558425e38541fa82c8b6d36514"),
    ("dvorak-new-world-ii-musopen.ogg", f"{COMMONS}/c/c3/{NAME}ii._largo.ogg", "ba3a97a55babe67965fc19d5227ed9e1a5ede5c73ec31d0feeaf274c448eedd6"),
    ("dvorak-new-world-iii-musopen.ogg", f"{COMMONS}/b/bd/{NAME}iii._molto_vivace.ogg", "08187532a52d1ccd117e07d0dde2c9e1e1e95ef517ac4039a06d08738579ee3f"),
    ("dvorak-new-world-iv-musopen.ogg", f"{COMMONS}/1/17/{NAME}iv._allegro_con_fuoco.ogg", "977ab2a29bc99804328a293d57b4af66a5d09533d1c8dc872a4314da0e188866"),
]
# Each movement's reverb is left this long to ring out, which is also the pause before the next.
TAIL_SECONDS = 12
# Each movement eases in and out of the hall noise its file starts and ends in.
FADE_IN = 0.5
FADE_OUT = 2.0
# YouTube plays music at about -14 LUFS; a little under leaves the quiet Largo its quiet.
LOUDNESS = "I=-16:TP=-1.5:LRA=18"


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def movement(source: Path, slowdown: float, work: Path) -> np.ndarray:
    """One movement slowed, saturated and reverberated as the site's tracks are, trimmed after its tail."""
    piece = soundtrack.Piece(source.stem, "", "", source.name, "", slowdown, None, None)
    seconds = soundtrack.stretched(piece, source, work)
    # The files start and end in the hall's noise (about -37 dB), not silence, and the saturation lifts it: faded,
    # instead of stepping from noise to digital zero, which clicks.
    dry = soundtrack.read_wav(work / "dry.wav")
    rate = soundtrack.RATE
    dry[: int(FADE_IN * rate)] *= np.linspace(0, 1, int(FADE_IN * rate))[:, None]
    dry[-int(FADE_OUT * rate):] *= np.linspace(1, 0, int(FADE_OUT * rate))[:, None]
    soundtrack.write_wav(work / "dry.wav", soundtrack.saturate(dry))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "dry.wav"),
                    "-i", str(work / "ir.wav"), "-filter_complex",
                    # Padded before the reverb, not after: afir stops when its input does, which cut each tail dead.
                    f"[0:a]apad=pad_dur={TAIL_SECONDS},asplit[dry][send];[send][1:a]afir=dry=10:wet=10[wet];"
                    "[dry]volume=0.4[quiet];"
                    f"[quiet][wet]amix=inputs=2:weights='1 1.0':normalize=0,volume={soundtrack.MIX_HEADROOM}[out]",
                    "-map", "[out]", str(work / "wet.wav")], check=True)
    wet = soundtrack.read_wav(work / "wet.wav")
    if np.abs(wet).max() >= 32766 / 32767:
        raise SystemExit(f"{source.name}: the reverb mix clips; lower MIX_HEADROOM")
    # Exactly the stretched music and its tail, so every movement starts on time.
    return wet[: int((seconds + TAIL_SECONDS) * soundtrack.RATE)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", type=Path)
    parser.add_argument("--minutes", type=float, default=60)
    parser.add_argument("--ends-early", type=float, default=10, help="seconds of silence before the video ends")
    args = parser.parse_args()

    sources = []
    for member, url, sha256 in MOVEMENTS:
        piece = soundtrack.Piece(member, "", url, member, sha256, 1, None, None)
        sources.append(soundtrack.source_file(piece))
    recorded = sum(duration(path) for path in sources)
    fill = args.minutes * 60 - args.ends_early - TAIL_SECONDS * len(sources)
    slowdown = recorded / fill
    if not 0.5 <= slowdown <= 1:
        raise SystemExit(f"filling {args.minutes} minutes needs a slowdown of {slowdown:.3f}, outside atempo's 0.5–1")
    print(f"{recorded / 60:.1f} minutes recorded, slowed to {slowdown:.3f} of their tempo", file=sys.stderr)

    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        soundtrack.write_wav(work / "ir.wav", soundtrack.impulse_response())
        parts = []
        for source in sources:
            parts.append(movement(source, slowdown, work))
            print(f"  {source.name}: {len(parts[-1]) / soundtrack.RATE / 60:.1f} min", file=sys.stderr)
        joined = np.concatenate(parts)
        # The movements' start times, as YouTube chapters.
        names = ["I. Adagio – Allegro molto", "II. Largo", "III. Molto vivace", "IV. Allegro con fuoco"]
        starts = np.cumsum([0] + [len(part) for part in parts[:-1]]) / soundtrack.RATE
        stamp = lambda seconds: f"{int(seconds // 60)}:{int(seconds % 60):02d}"
        args.out.with_suffix(".chapters.txt").write_text("".join(f"{stamp(start)} {name}\n" for start, name in zip(starts, names)))
        soundtrack.write_wav(work / "joined.wav", joined * 0.89 / np.abs(joined).max())
        # Two-pass loudness normalisation: measured over the whole symphony, then applied as one linear gain, so the
        # Largo stays as much quieter than the finale as it was.
        measured = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(work / "joined.wav"), "-af",
                                   f"loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-"],
                                  capture_output=True, text=True, check=True).stderr
        stats = json.loads(measured[measured.rindex("{"):measured.rindex("}") + 1])
        second = (f"loudnorm={LOUDNESS}:linear=true:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
                  f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "joined.wav"),
                        "-af", second, "-ar", "48000", "-sample_fmt", "s32", "-c:a", "flac", str(args.out)], check=True)
    print(f"wrote {args.out}: {duration(args.out) / 60:.2f} min", file=sys.stderr)


if __name__ == "__main__":
    main()
