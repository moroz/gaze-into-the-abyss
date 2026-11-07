// When rendering a video (#render), backgrounds play from frames decoded ahead of time instead of from <video>, so
// every frame of the recording shows exactly the footage at its time. script/render/render.mjs extracts the frames
// and serves them, with a manifest, under the path #render names.

import type { Footage } from "./video-warp"
import type { SlideData, VideoSource } from "./slideshow"

interface Entry { fps: number; frames: number; width: number; height: number }

const manifests = new Map<string, Promise<Record<string, Entry>>>()
const manifest = (base: string): Promise<Record<string, Entry>> => {
  if (!manifests.has(base)) manifests.set(base, fetch(`${base}/manifest.json`).then((response) => response.json()))
  return manifests.get(base)!
}

// The video's file name without its extension, which names its folder of frames.
export const stemOf = (url: string): string => url.split("/").pop()!.replace(/\.mp4$/, "")

const AHEAD = 3

export class FrameVideo implements VideoSource {
  private entry: Entry | undefined
  private seconds = 0
  private since: number | undefined
  private shown: { index: number; bitmap: ImageBitmap } | undefined
  private fetching = new Map<number, Promise<ImageBitmap>>()
  private readonly stem: string

  constructor(data: SlideData, private base: string) {
    this.stem = stemOf(data.h264 ?? "")
  }

  async load(): Promise<boolean> {
    this.entry = (await manifest(this.base))[this.stem]
    return !!this.entry
  }

  // Like a <video>, it keeps its place while paused and loops.
  play(): void {
    this.since ??= performance.now()
  }

  pause(): void {
    if (this.since === undefined) return
    this.seconds += (performance.now() - this.since) / 1000
    this.since = undefined
    for (const pending of this.fetching.values()) pending.then((bitmap) => bitmap.close())
    this.fetching.clear()
    this.shown?.bitmap.close()
    this.shown = undefined
  }

  private time(): number {
    return this.seconds + (this.since === undefined ? 0 : (performance.now() - this.since) / 1000)
  }

  private fetchFrame(index: number): Promise<ImageBitmap> {
    let pending = this.fetching.get(index)
    if (!pending) {
      const name = String(index + 1).padStart(5, "0")
      pending = fetch(`${this.base}/${this.stem}/${name}.jpg`)
        .then((response) => response.blob())
        .then((blob) => createImageBitmap(blob, { imageOrientation: "flipY" }))
      this.fetching.set(index, pending)
    }
    return pending
  }

  // Decodes the frame for the clock's current time (and starts on the next few) before the stage draws.
  async prepare(): Promise<void> {
    const entry = this.entry
    if (!entry || this.since === undefined) return
    const index = Math.floor(this.time() * entry.fps + 1e-6) % entry.frames
    if (this.shown?.index !== index) {
      const bitmap = await this.fetchFrame(index)
      this.fetching.delete(index)
      this.shown?.bitmap.close()
      this.shown = { index, bitmap }
    }
    for (let ahead = 1; ahead <= AHEAD; ahead++) this.fetchFrame((index + ahead) % entry.frames)
    // Frames behind the shown one are not needed again before the loop comes round.
    for (const [kept, pending] of this.fetching) {
      if ((kept - index + entry.frames) % entry.frames > AHEAD) {
        this.fetching.delete(kept)
        pending.then((bitmap) => bitmap.close())
      }
    }
  }

  footage(): Footage | undefined {
    if (!this.shown || !this.entry) return undefined
    return { source: this.shown.bitmap, width: this.entry.width, height: this.entry.height, flip: false }
  }
}
