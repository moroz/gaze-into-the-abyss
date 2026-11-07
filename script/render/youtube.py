#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-api-python-client==2.187.0", "google-auth-oauthlib==1.2.2"]
# ///
"""Uploads the rendered video to YouTube, private, with a description built from the credits in src/data.

    uv run script/render/youtube.py describe > description.txt          # the description, to read and edit first
    uv run script/render/youtube.py upload VIDEO --title "…" --description description.txt [--yes]

The OAuth client (a Desktop app client of a Google Cloud project with the YouTube Data API v3 enabled) is read from
an age-encrypted client_secret.json, decrypted in memory with an SSH key; the refresh token Google returns is kept
age-encrypted to the same key. Uploads from an API project YouTube has not audited are locked to private: make the
video public in YouTube Studio.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SECRET = Path.home() / "working/abyss/client_secret.json.age"
TOKEN = Path.home() / ".config/abyss-youtube/token.json.age"
KEY = Path.home() / ".ssh/id_ed25519"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
MUSIC_CATEGORY = "10"
CHUNK = 64 * 1024 * 1024
FILE = "Antonin_Dvorak_-_symphony_no._9_in_e_minor_%27from_the_new_world%27,_op._95_-_"
MOVEMENT_PAGES = [("I. Adagio – Allegro molto", "i._adagio_-_allegro_molto"), ("II. Largo", "ii._largo"),
                  ("III. Molto vivace", "iii._molto_vivace"), ("IV. Allegro con fuoco", "iv._allegro_con_fuoco")]


def decrypt(path: Path) -> bytes:
    return subprocess.run(["age", "-d", "-i", str(KEY), str(path)], capture_output=True, check=True).stdout


def encrypt(data: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    subprocess.run(["age", "-R", f"{KEY}.pub", "-o", str(path)], input=data, check=True)


def credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    if TOKEN.exists():
        creds = Credentials.from_authorized_user_info(json.loads(decrypt(TOKEN)), SCOPES)
        if creds.valid:
            return creds
        if creds.refresh_token:
            creds.refresh(Request())
            encrypt(creds.to_json().encode(), TOKEN)
            return creds
    flow = InstalledAppFlow.from_client_config(json.loads(decrypt(SECRET)), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True, prompt="consent")
    encrypt(creds.to_json().encode(), TOKEN)
    return creds


def chapters() -> list[str]:
    """YouTube chapters for the movements, from the start times symphony.py writes beside the soundtrack."""
    path = Path.home() / "Videos/abyss-render/new-world.chapters.txt"
    if not path.exists():
        return []
    return [*path.read_text().strip().splitlines(), ""]


def describe() -> str:
    backgrounds = sorted(json.loads((ROOT / "src/data/backgrounds.json").read_text()), key=lambda entry: entry["position"])
    lines = [
        "An hour of Gaze into the Abyss: space photos and nature footage, warped and recoloured, with a shader "
        "drawn over them. Rendered frame by frame from the site's code: https://github.com/moroz/gaze-into-the-abyss",
        "",
        "Music: Dvořák, Symphony No. 9 in E minor, \"From the New World\" (1893), all four movements, played at about "
        "70% speed with a long reverb. Musopen recording, public domain:",
        *[f"- {name}: https://commons.wikimedia.org/wiki/File:{FILE}{slug}.ogg" for name, slug in MOVEMENT_PAGES],
        "",
        *chapters(),
        "Backgrounds:",
    ]
    for entry in backgrounds:
        author = entry["author"].rstrip(".")
        licence = f"{entry['licence']} ({entry['licenceUrl']})" if entry.get("licenceUrl") else entry["licence"]
        lines.append(f"- {entry['title']}, {author}. {licence}. {entry['sourceUrl']}")
    share_alike = [entry for entry in backgrounds if "SA" in entry["licence"]]
    lines += [
        "",
        f"{len(share_alike)} of the backgrounds are CC BY-SA, so this video is CC BY-SA 4.0 too: "
        "https://creativecommons.org/licenses/by-sa/4.0/",
    ]
    return "\n".join(lines) + "\n"


def upload(video: Path, title: str, description: str, tags: list[str], yes: bool) -> None:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    body = {
        "snippet": {"title": title, "description": description, "tags": tags, "categoryId": MUSIC_CATEGORY,
                    "defaultLanguage": "en", "defaultAudioLanguage": "zxx"},
        "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "license": "youtube",
                   "embeddable": True},
    }
    size = video.stat().st_size
    print(f"{video} ({size / 1e9:.1f} GB)\n{json.dumps(body, indent=2, ensure_ascii=False)}", file=sys.stderr)
    if not yes and input("Upload this, private, to your channel? [y/N] ").strip().lower() != "y":
        raise SystemExit("not uploaded")
    youtube = build("youtube", "v3", credentials=credentials())
    request = youtube.videos().insert(part="snippet,status", body=body,
                                      media_body=MediaFileUpload(str(video), chunksize=CHUNK, resumable=True))
    response = None
    failures = 0
    started = time.monotonic()
    while response is None:
        try:
            status, response = request.next_chunk()
            failures = 0
            if status:
                done = status.progress()
                elapsed = time.monotonic() - started
                print(f"  {done * 100:5.1f}%  {done * size / elapsed / 1e6:.0f} MB/s", file=sys.stderr)
        except HttpError as error:
            if error.resp.status not in (500, 502, 503, 504) or failures >= 8:
                raise
            failures += 1
            time.sleep(min(60, 2 ** failures))
        except (ConnectionError, TimeoutError, OSError):
            if failures >= 8:
                raise
            failures += 1
            time.sleep(min(60, 2 ** failures))
    print(f"uploaded, private: https://studio.youtube.com/video/{response['id']}/edit", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("describe")
    commands.add_parser("login")
    up = commands.add_parser("upload")
    up.add_argument("video", type=Path)
    up.add_argument("--title", required=True)
    up.add_argument("--description", type=Path, required=True)
    up.add_argument("--tags", default="music for tripping,psychedelic,visuals,Dvořák,New World Symphony,4K")
    up.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if args.command == "describe":
        sys.stdout.write(describe())
    elif args.command == "login":
        credentials()
        print(f"signed in; token kept in {TOKEN}", file=sys.stderr)
    else:
        upload(args.video, args.title, args.description.read_text(), args.tags.split(","), args.yes)


if __name__ == "__main__":
    main()
