// Chooses the backgrounds, when they change and how. It draws nothing itself: the stage reads onScreen() every frame.
// The order of every random draw is the one the slideshow has always made, so a seed replays the same backgrounds.

import { randomStream } from "./random"
import type { Footage, VideoEffect } from "./video-warp"
import { VIDEO_EFFECTS } from "./video-warp"
import { mood } from "./mood"

const FIRST_IMAGE_PATIENCE_MS = 6_000
const VIDEO_PATIENCE_MS = 60_000

const VIDEO_SOURCES = [
  ["av1", 'video/mp4; codecs="av01.0.08M.08"'],
  ["h264", 'video/mp4; codecs="avc1.640029"'],
] as const

export const TRANSITION_MS = {
  crossfade: 4_000,
  "through-black": 6_000,
  bloom: 5_000,
  dissolve: 9_000,
} as const
export type Transition = keyof typeof TRANSITION_MS
const TRANSITIONS = mood.transitions

// An image's slow zoom and pan while it shows: scale, then translate (in percent of the screen), then rotate (in
// degrees), from one pose to the other.
export interface Pose { scale: number; x: number; y: number; rotate: number }
const pose = (scale: number, x = 0, y = 0, rotate = 0): Pose => ({ scale, x, y, rotate })
const DRIFTS: [Pose, Pose][] = [
  [pose(1.04), pose(1.16, -2, -1.5)],
  [pose(1.18, 2, 1), pose(1.04, -1, 0)],
  [pose(1.08, -2, 1.5, -1), pose(1.18, 1.5, -1, 1)],
  [pose(1.15, 0, -2), pose(1.05, 0, 2)],
  [pose(1.06, 0, 0, 1.5), pose(1.2, 1, 2, -1)],
  [pose(1.2, -1.5, 0), pose(1.06, 1.5, -1)],
]

export type Overlay = "calm" | "psychedelic" | "hue-cycle"
export type Subject = "space" | "wildlife" | "landscape" | "sea" | "fire"

export interface SlideData {
  kind: "image" | "video"
  overlay: Overlay
  credit: Record<string, string | undefined>
  subject: Subject
  effects?: VideoEffect[]
  distortion: number
  av1?: string
  h264?: string
  // An image's widths on the CDN, narrowest first.
  widths?: { width: number; url: string }[]
}

// Where a video's frames come from: a <video> playing on the site, or decoded frames when rendering a video.
export interface VideoSource {
  load(): Promise<boolean>
  play(): void
  pause(): void
  footage(): Footage | undefined
}

export interface Slide {
  data: SlideData
  image?: HTMLImageElement
  video?: VideoSource
}

export interface Showing {
  slide: Slide
  transition: Transition
  arrivedAt: number
  leftAt?: number
  leavingBy?: Transition
  drift: [Pose, Pose]
  driftMs: number
  pace: number
  effect: VideoEffect
  strength: number
}

const within = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])

// The narrowest width that covers the screen with the drift's zoom to spare (the stylesheet's sizes="118vw").
const imageUrl = (widths: { width: number; url: string }[]): string => {
  const wanted = 1.18 * window.innerWidth * (window.devicePixelRatio || 1)
  return (widths.find(({ width }) => width >= wanted) ?? widths[widths.length - 1]).url
}

const loadImage = async (slide: Slide): Promise<boolean> => {
  if (!slide.image) {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.decoding = "async"
    image.src = imageUrl(slide.data.widths ?? [])
    slide.image = image
  }
  return slide.image.decode().then(() => true, () => false)
}

// A <video> kept out of sight that the stage reads frames from. It starts playing while it loads: iOS buffers only a
// playing video, and it arrives already in motion. One that cannot play (no source decodes, or Low Power Mode refuses
// playback) resolves false and is skipped.
export class ElementVideo implements VideoSource {
  readonly element: HTMLVideoElement

  constructor(private data: SlideData, pool: HTMLElement) {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.loop = true
    video.preload = "none"
    video.playsInline = true
    video.disablePictureInPicture = true
    for (const attribute of ["muted", "playsinline"]) video.setAttribute(attribute, "")
    pool.append(video)
    this.element = video
  }

  load(): Promise<boolean> {
    const video = this.element
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && video.querySelector("source")) return Promise.resolve(false)
    if (!video.querySelector("source")) {
      for (const [codec, type] of VIDEO_SOURCES) {
        const source = document.createElement("source")
        source.src = this.data[codec] ?? ""
        source.type = type
        video.append(source)
      }
    }
    // The listeners go once the race settles, so they do not pile up each time the video comes round again.
    const settled = new AbortController()
    const ready = new Promise<boolean>((resolve) => {
      if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) resolve(true)
      video.addEventListener("canplaythrough", () => resolve(true), { signal: settled.signal })
      // With <source> children the element itself never fires error; the last source does, once every one has failed.
      video.lastElementChild!.addEventListener("error", () => resolve(false), { signal: settled.signal })
      video.play().catch(() => resolve(false))
    })
    return within(ready, VIDEO_PATIENCE_MS, false).then((playable) => {
      settled.abort()
      return playable
    })
  }

  play(): void {
    this.element.play().catch(() => {})
  }

  pause(): void {
    this.element.pause()
  }

  footage(): Footage | undefined {
    const video = this.element
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return undefined
    return { source: video, width: video.videoWidth, height: video.videoHeight, flip: true }
  }
}

export interface Slideshow {
  // Bottom first: the background leaving, then the one arriving or showing.
  onScreen(): Showing[]
  // Seconds into the shared hue drift at page load, so every picture's drift stays in step.
  hueDelay: number
  // The background loaded and waiting for its turn, if any.
  upcoming(): Slide | undefined
  // Resolves once the first background is on screen.
  started: Promise<void>
}

export function runSlideshow(slides: Slide[], onChange: () => void, track: <T>(promise: Promise<T>) => Promise<T> = (promise) => promise): Slideshow {
  const { between, next: random, pick, shuffledForever } = randomStream("slides")
  const next = shuffledForever(slides)
  // Each showing gets its own pace, which scales the slide's colour cycles and its video's warp, and a video its own
  // strength of distortion around the entry's setting.
  const paces = randomStream("background pace")
  const distortions = randomStream("distortion")

  // Each time a video comes on screen it gets one effect, from its own list where it has one;
  // #effect=<name> holds every video to that one.
  const effects = randomStream("video effects")
  const chosenEffect = new URLSearchParams(location.hash.slice(1)).get("effect") as VideoEffect | null
  const effectFor = (slide: Slide): VideoEffect => {
    if (chosenEffect && VIDEO_EFFECTS.includes(chosenEffect)) return chosenEffect
    const allowed = mood.effects ?? VIDEO_EFFECTS
    const suited = (slide.data.effects ?? []).filter((name) => allowed.includes(name))
    return effects.pick(suited.length ? suited : allowed)
  }

  const hueDelay = random() * 180
  let current: Showing | undefined
  let upcoming: Slide | undefined
  const leaving: Showing[] = []

  const load = (slide: Slide): Promise<boolean> => track(slide.video ? slide.video.load() : loadImage(slide))

  const show = (arriving: Slide, transition: Transition, holdMs: number): void => {
    const now = performance.now()
    const left = current
    if (left) {
      left.leftAt = now
      left.leavingBy = transition
      leaving.push(left)
      setTimeout(() => {
        leaving.splice(leaving.indexOf(left), 1)
        // Not one that is back on screen, or loaded to come back next: pausing that would leave it cold.
        if (current?.slide !== left.slide && upcoming !== left.slide) left.slide.video?.pause()
        onChange()
      }, TRANSITION_MS[transition])
    }
    const drift = pick(DRIFTS)
    const pace = Number(paces.between(0.6, 1.6).toFixed(2))
    let effect: VideoEffect = "ripple"
    let strength = 1
    if (arriving.video) {
      effect = effectFor(arriving)
      strength = Number((arriving.data.distortion * mood.distortion * distortions.between(0.6, 1.25)).toFixed(2))
      arriving.video.play()
    }
    current = { slide: arriving, transition, arrivedAt: now, drift, driftMs: holdMs + TRANSITION_MS[transition], pace, effect, strength }
    // Lets the caption follow the background.
    document.dispatchEvent(new CustomEvent("abyss:background", { detail: arriving.data.credit }))
    onChange()
  }

  // A background that fails to load is skipped for the next one, trying each at most once per round; if none
  // loads, the current one stays for another hold.
  const prepare = async (): Promise<Slide | undefined> => {
    for (let tries = 0; tries < slides.length; tries++) {
      const candidate = next()
      if (candidate === current?.slide) continue
      if (await load(candidate)) return candidate
      // A video that failed while out of sight stops trying to play.
      candidate.video?.pause()
    }
    return undefined
  }

  const continueAfter = (holdMs: number): void => {
    const ready = prepare()
    ready.then((slide) => { upcoming = slide })
    setTimeout(async () => {
      const next = await ready
      upcoming = undefined
      const hold = between(...mood.holdMs)
      if (next) show(next, pick(TRANSITIONS), hold)
      continueAfter(hold)
    }, holdMs)
  }

  // The first background gets FIRST_IMAGE_PATIENCE_MS under the dark veil. One that is merely slow is shown and
  // goes on loading; one that fails outright gives way to the next that loads.
  const started = (async () => {
    let first = next()
    const outcome = await within(load(first).then((ok) => (ok ? "loaded" : "failed")), FIRST_IMAGE_PATIENCE_MS, "slow")
    if (outcome === "failed") first = (await prepare()) ?? first
    const hold = between(...mood.holdMs)
    show(first, "crossfade", hold)
    continueAfter(hold)
  })()

  return { onScreen: () => (current ? [...leaving, current] : []), upcoming: () => upcoming, hueDelay, started }
}
