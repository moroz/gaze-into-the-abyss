#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mido", "numpy"]
# ///
# Needs fluidsynth, the FluidR3 GM soundfont (Debian: fluid-soundfont-gm) and ffmpeg with libmp3lame;
# uv supplies the Python packages.
import io
import json
import subprocess
import sys
import tempfile
import urllib.request
import wave
import zipfile
from pathlib import Path
from typing import NamedTuple

import mido
import numpy as np

SOUNDFONT = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / "public/music"
PLAYLIST = ROOT / "src/data/music.json"
RATE = 44100
REVERB_SECONDS = 11.0
SILENCE_DB = -70
FADE_OUT_SECONDS = 8.0
# How hard the dry orchestra is driven into tanh saturation before the reverb.
DRIVE = 3.0
# Wikimedia refuses downloads that do not say who is asking.
USER_AGENT = "gaze-into-the-abyss soundtrack renderer (https://github.com/moroz/gaze-into-the-abyss)"

class Piece(NamedTuple):
    output: str
    source: str
    member: str
    slowdown: float
    first_bar: int | None
    last_bar: int | None


def playlist() -> list[Piece]:
    entries = sorted(json.loads(PLAYLIST.read_text()), key=lambda entry: entry["position"])
    return [Piece(entry["file"], entry.get("sourceZip") or entry["midi"], entry["member"], entry["slowdown"],
                  entry.get("firstBar"), entry.get("lastBar"))
            for entry in entries]


def slowed(source: mido.MidiFile, piece: Piece) -> mido.MidiFile:
    """The piece as written, on the instruments its MIDI names, cut to its bars and played slower."""
    if piece.first_bar or piece.last_bar:
        bars = bar_starts(source)
        start = bars[piece.first_bar - 1] if piece.first_bar else 0
        end = bars[piece.last_bar] if piece.last_bar else None
        for track in source.tracks:
            excerpt(track, start, end)
    for track in source.tracks:
        for index, message in enumerate(track):
            if message.type == "set_tempo":
                track[index] = message.copy(tempo=int(message.tempo / piece.slowdown))
    return source


def bar_starts(midi: mido.MidiFile) -> list[int]:
    """The tick each bar starts on, following the file's time signatures (4/4 until one is given)."""
    signatures, length = [], 0
    for track in midi.tracks:
        tick = 0
        for message in track:
            tick += message.time
            if message.type == "time_signature":
                signatures.append((tick, message.numerator, message.denominator))
        length = max(length, tick)
    starts, tick = [], 0
    while tick <= length:
        numerator, denominator = 4, 4
        for at, top, bottom in sorted(signatures):
            if at <= tick:
                numerator, denominator = top, bottom
        starts.append(tick)
        tick += numerator * midi.ticks_per_beat * 4 // denominator
    return starts + [tick]


def excerpt(track: mido.MidiTrack, start: int, end: int | None) -> None:
    """Keep the ticks from start to end. Instrument and tempo changes before start take effect on its first tick."""
    timed, tick = [], 0
    for message in track:
        tick += message.time
        if message.type == "end_of_track" or (end is not None and tick > end):
            continue
        if tick >= start:
            timed.append((tick - start, message))
        elif message.type not in ("note_on", "note_off"):
            timed.append((0, message))
    sounding = set()
    for _, message in timed:
        if message.type == "note_on" and message.velocity:
            sounding.add((message.channel, message.note))
        elif message.type in ("note_on", "note_off"):
            sounding.discard((message.channel, message.note))
    finish_at = end - start if end is not None else max((at for at, _ in timed), default=0)
    timed += [(finish_at, mido.Message("note_off", channel=channel, note=note)) for channel, note in sorted(sounding)]
    timed.append((finish_at, mido.MetaMessage("end_of_track")))
    previous = 0
    track[:] = []
    for at, message in timed:
        track.append(message.copy(time=at - previous))
        previous = at


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as file:
        frames = np.frombuffer(file.readframes(file.getnframes()), dtype="<i2")
        return frames.astype(np.float64).reshape(-1, file.getnchannels()) / 32767


def write_wav(path: Path, samples: np.ndarray) -> None:
    with wave.open(str(path), "wb") as file:
        file.setnchannels(samples.shape[1])
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes((samples * 32767).astype("<i2").tobytes())


def impulse_response() -> np.ndarray:
    count = int(RATE * REVERB_SECONDS)
    seconds = np.arange(count) / RATE
    noise = np.random.default_rng(1893).standard_normal((count, 2))
    smoothed = np.stack([np.convolve(noise[:, side], np.ones(6) / 6, mode="same") for side in range(2)], axis=1)
    envelope = np.exp(-seconds * 9.6 / REVERB_SECONDS) * np.minimum(1, seconds / 0.03)
    response = smoothed * envelope[:, None]
    return response / np.abs(response).max() * 0.98


def saturate(samples: np.ndarray) -> np.ndarray:
    return np.tanh(samples / np.abs(samples).max() * DRIVE) / np.tanh(DRIVE)


def finish(samples: np.ndarray, music_seconds: float, cut_short: bool) -> np.ndarray:
    loudness = np.sqrt((samples ** 2).mean(axis=1))
    audible_end = np.nonzero(loudness > 10 ** (SILENCE_DB / 20))[0][-1] + 1
    samples = samples[:audible_end].copy()
    if cut_short:
        fade_start = int((music_seconds - FADE_OUT_SECONDS) * RATE)
        ramp = np.clip(1 - (np.arange(len(samples)) - fade_start) / (FADE_OUT_SECONDS * RATE), 0, 1)
        samples *= ramp[:, None]
    return samples * 0.89 / np.abs(samples).max()


def render(piece: Piece, work: Path) -> None:
    request = urllib.request.Request(piece.source, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request) as response:
        download = response.read()
    if piece.source.endswith(".zip"):
        download = zipfile.ZipFile(io.BytesIO(download)).read(piece.member)
    midi = slowed(mido.MidiFile(file=io.BytesIO(download)), piece)
    midi.save(work / "slowed.mid")
    subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", str(RATE), "-R", "1", "-C", "1",
                    "-o", "synth.reverb.room-size=0.95", "-o", "synth.reverb.damp=0.3",
                    "-o", "synth.reverb.width=1.0", "-o", "synth.reverb.level=0.9",
                    "-o", "synth.chorus.depth=8", "-F", str(work / "dry.wav"), SOUNDFONT,
                    str(work / "slowed.mid")], check=True)
    write_wav(work / "dry.wav", saturate(read_wav(work / "dry.wav")))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "dry.wav"),
                    "-i", str(work / "ir.wav"), "-filter_complex",
                    "[0:a]asplit[dry][send];[send][1:a]afir=dry=10:wet=10[wet];[dry]volume=0.4[quiet];"
                    "[quiet][wet]amix=inputs=2:weights='1 1.0':normalize=0,apad=pad_dur=12[out]",
                    "-map", "[out]", str(work / "wet.wav")], check=True)
    finished = finish(read_wav(work / "wet.wav"), midi.length, cut_short=piece.last_bar is not None)
    write_wav(work / "finished.wav", finished)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "finished.wav"),
                    "-af", "loudnorm=I=-20:TP=-2:LRA=14", "-ar", str(RATE), "-c:a", "libmp3lame",
                    "-b:a", "96k", str(MUSIC / piece.output)], check=True)
    print(f"wrote {piece.output}", file=sys.stderr)


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        write_wav(work / "ir.wav", impulse_response())
        for piece in playlist():
            render(piece, work)


if __name__ == "__main__":
    main()
