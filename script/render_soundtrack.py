#!/usr/bin/env python3
# Needs fluidsynth, the FluidR3 GM soundfont (Debian: fluid-soundfont-gm), ffmpeg with libmp3lame,
# and the Python packages mido and numpy.
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
REVERB_SECONDS = 7.0
SILENCE_DB = -70
FADE_OUT_SECONDS = 8.0

GENERAL_MIDI = {
    "celesta": 8, "vibraphone": 11, "church organ": 19, "harp": 46, "french horn": 60,
    "pan flute": 75, "shakuhachi": 77, "ocarina": 79, "warm pad": 89, "bowed glass pad": 92, "kalimba": 108,
    "tinkle bell": 112, "taiko": 116,
}


class Voice(NamedTuple):
    instrument: str | None
    detune_cents: int
    velocity_scale: float


BAND = {
    "flute": Voice("ocarina", 0, 0.8),
    "oboe": Voice("shakuhachi", 0, 0.85),
    "clarinet": Voice("vibraphone", 12, 0.8),
    "bassoon": Voice("church organ", 0, 0.55),
    "first horn": Voice("french horn", 15, 0.75),
    "second horn": Voice("french horn", -15, 0.7),
    "trumpet": Voice("pan flute", 0, 0.75),
    "timpani": Voice("taiko", 0, 0.7),
    "solo": Voice("french horn", 0, 0.9),
    "first violins": Voice("celesta", 20, 0.8),
    "second violins": Voice("kalimba", -20, 0.7),
    "violas": Voice("harp", -10, 0.75),
    "cellos": Voice("bowed glass pad", 0, 0.75),
    "basses": Voice("warm pad", 0, 0.7),
    "triangle": Voice("tinkle bell", 0, 0.6),
}

PART_NAMES = {
    "flauti": "flute", "flauti2": "flute", "oboi": "oboe", "clarinetti": "clarinet", "fagotti": "bassoon",
    "corni": "first horn", "corni_first": "first horn", "corni_second": "second horn", "trumpet": "trumpet", "timpani": "timpani",
    "solo": "solo",
    "violin_one": "first violins", "violiniI": "first violins",
    "violin_two": "second violins", "violiniII": "second violins",
    "viola": "violas", "viole": "violas",
    "violincello": "cellos", "violoncelli": "cellos",
    "contrabass": "basses", "contrabassi": "basses",
}


class Piece(NamedTuple):
    output: str
    source: str
    member: str
    slowdown: float
    last_bar: int | None
    parts: list[str] | None


def playlist() -> list[Piece]:
    entries = sorted(json.loads(PLAYLIST.read_text()), key=lambda entry: entry["position"])
    return [Piece(entry["file"], entry.get("sourceZip") or entry["midi"], entry["member"], entry["slowdown"],
                  entry.get("lastBar"), entry.get("parts"))
            for entry in entries]


def part_names(midi: mido.MidiFile, piece: Piece) -> list[str | None]:
    playing = [any(message.type == "note_on" for message in track) for track in midi.tracks]
    if piece.parts is None:
        return [part_named(track.name) if plays else None for track, plays in zip(midi.tracks, playing)]
    if len(piece.parts) != sum(playing):
        raise SystemExit(f"{piece.output} lists {len(piece.parts)} parts for {sum(playing)} playing tracks")
    listed = iter(piece.parts)
    return [next(listed) if plays else None for plays in playing]


def part_named(track_name: str) -> str:
    name = track_name.split(":")[0]
    if name not in PART_NAMES:
        raise SystemExit(f"no band member plays the part {track_name!r}")
    return PART_NAMES[name]


def recast(source: mido.MidiFile, piece: Piece) -> mido.MidiFile:
    for track, part in zip(source.tracks, part_names(source, piece)):
        if piece.last_bar:
            end_at_bar(track, piece.last_bar * 4 * source.ticks_per_beat)
        if part is not None and part not in BAND:
            raise SystemExit(f"{piece.output} names {part!r}, which is not in the band")
        voice = BAND[part] if part else Voice(None, 0, 1)
        messages = []
        for message in track:
            if message.type == "set_tempo":
                message = message.copy(tempo=int(message.tempo / piece.slowdown))
            elif message.type == "program_change" and voice.instrument:
                messages.append(message.copy(program=GENERAL_MIDI[voice.instrument]))
                bend = int(8192 * voice.detune_cents / 200)
                message = mido.Message("pitchwheel", channel=message.channel, pitch=bend)
            elif message.type == "note_on" and message.velocity:
                message = message.copy(velocity=max(1, int(message.velocity * voice.velocity_scale)))
            messages.append(message)
        track[:] = messages
    return source


def end_at_bar(track: mido.MidiTrack, end_tick: int) -> None:
    timed, tick = [], 0
    for message in track:
        tick += message.time
        if tick <= end_tick and message.type != "end_of_track":
            timed.append((tick, message))
    sounding = set()
    for _, message in timed:
        if message.type == "note_on" and message.velocity:
            sounding.add((message.channel, message.note))
        elif message.type in ("note_on", "note_off"):
            sounding.discard((message.channel, message.note))
    timed += [(end_tick, mido.Message("note_off", channel=channel, note=note)) for channel, note in sorted(sounding)]
    timed.append((end_tick, mido.MetaMessage("end_of_track")))
    previous = 0
    track[:] = []
    for tick, message in timed:
        track.append(message.copy(time=tick - previous))
        previous = tick


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
    with urllib.request.urlopen(piece.source) as response:
        download = response.read()
    if piece.source.endswith(".zip"):
        download = zipfile.ZipFile(io.BytesIO(download)).read(piece.member)
    midi = recast(mido.MidiFile(file=io.BytesIO(download)), piece)
    midi.save(work / "recast.mid")
    subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", str(RATE), "-R", "1", "-C", "1",
                    "-o", "synth.reverb.room-size=0.95", "-o", "synth.reverb.damp=0.3",
                    "-o", "synth.reverb.width=1.0", "-o", "synth.reverb.level=0.9",
                    "-o", "synth.chorus.depth=8", "-F", str(work / "dry.wav"), SOUNDFONT,
                    str(work / "recast.mid")], check=True)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "dry.wav"),
                    "-i", str(work / "ir.wav"), "-filter_complex",
                    "[0:a]asplit[dry][send];[send][1:a]afir=dry=10:wet=10[wet];[dry]volume=0.55[quiet];"
                    "[quiet][wet]amix=inputs=2:weights='1 0.6':normalize=0,apad=pad_dur=8[out]",
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
