import { randomStream } from "./random"

const HOLD_MS: [number, number] = [18_000, 32_000]
const FIRST_IMAGE_PATIENCE_MS = 6_000
const VIDEO_PATIENCE_MS = 60_000

const VIDEO_SOURCES = [
  ["av1", 'video/mp4; codecs="av01.0.08M.08"'],
  ["h264", 'video/mp4; codecs="avc1.640029"'],
] as const

const TRANSITION_MS = {
  crossfade: 4_000,
  "through-black": 6_000,
  bloom: 5_000,
  dissolve: 9_000,
} as const
type Transition = keyof typeof TRANSITION_MS
const TRANSITIONS = Object.keys(TRANSITION_MS) as Transition[]

const DRIFTS: [string, string][] = [
  ["scale(1.04)", "scale(1.16) translate(-2%, -1.5%)"],
  ["scale(1.18) translate(2%, 1%)", "scale(1.04) translate(-1%, 0)"],
  ["scale(1.08) translate(-2%, 1.5%) rotate(-1deg)", "scale(1.18) translate(1.5%, -1%) rotate(1deg)"],
  ["scale(1.15) translate(0, -2%)", "scale(1.05) translate(0, 2%)"],
  ["scale(1.06) rotate(1.5deg)", "scale(1.2) translate(1%, 2%) rotate(-1deg)"],
  ["scale(1.2) translate(-1.5%, 0)", "scale(1.06) translate(1.5%, -1%)"],
]

const within = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])

const loadImage = async (image: HTMLImageElement): Promise<boolean> => {
  if (!image.getAttribute("srcset")) {
    image.srcset = image.dataset.srcset ?? ""
    image.src = image.dataset.src ?? ""
  }
  return image.decode().then(() => true, () => false)
}

// Resolves true once the browser expects to play the loop through, AV1 first where it is supported. The muted video
// starts playing while still invisible: iOS buffers only a playing video, and it arrives already in motion. A video
// that cannot play (no source decodes, or Low Power Mode refuses playback) resolves false and is skipped.
const loadVideo = (video: HTMLVideoElement): Promise<boolean> => {
  if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && video.querySelector("source")) return Promise.resolve(false)
  if (!video.querySelector("source")) {
    for (const [codec, type] of VIDEO_SOURCES) {
      const source = document.createElement("source")
      source.src = video.dataset[codec] ?? ""
      source.type = type
      video.append(source)
    }
  }
  const ready = new Promise<boolean>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) resolve(true)
    video.addEventListener("canplaythrough", () => resolve(true), { once: true })
    // With <source> children the element itself never fires error; the last source does, once every one has failed.
    video.lastElementChild!.addEventListener("error", () => resolve(false), { once: true })
    video.play().catch(() => resolve(false))
  })
  return within(ready, VIDEO_PATIENCE_MS, false).then((playable) => {
    if (!playable) video.pause()
    return playable
  })
}

const pictureOf = (slide: HTMLElement): HTMLImageElement | HTMLVideoElement => slide.querySelector("video") ?? slide.querySelector("img")!

const load = (slide: HTMLElement): Promise<boolean> => {
  const picture = pictureOf(slide)
  return picture instanceof HTMLVideoElement ? loadVideo(picture) : loadImage(picture)
}

// Lets the caption follow the background.
const announce = (slide: HTMLElement): void => {
  document.dispatchEvent(new CustomEvent("abyss:background", { detail: JSON.parse(slide.dataset.credit ?? "{}") }))
}

export async function runSlideshow(container: HTMLElement, slides: HTMLElement[]): Promise<void> {
  const { between, next: random, pick, shuffledForever } = randomStream("slides")
  const next = shuffledForever(slides)
  let current: HTMLElement | undefined

  container.style.setProperty("--hue-delay", `-${random() * 180}s`)

  const show = (arriving: HTMLElement, transition: Transition, holdMs: number): void => {
    const leaving = current
    if (leaving) {
      leaving.dataset.transition = transition
      leaving.classList.replace("is-active", "is-leaving")
      setTimeout(() => {
        leaving.classList.remove("is-leaving")
        const picture = pictureOf(leaving)
        if (picture instanceof HTMLVideoElement && !leaving.classList.contains("is-active")) picture.pause()
      }, TRANSITION_MS[transition])
    }
    const [from, to] = pick(DRIFTS)
    arriving.classList.remove("is-leaving", "is-active")
    arriving.dataset.transition = transition
    arriving.style.setProperty("--from", from)
    arriving.style.setProperty("--to", to)
    arriving.style.setProperty("--drift-ms", `${holdMs + TRANSITION_MS[transition]}ms`)
    void arriving.offsetWidth
    arriving.classList.add("is-active")
    const picture = pictureOf(arriving)
    if (picture instanceof HTMLVideoElement) picture.play().catch(() => {})
    announce(arriving)
    current = arriving
  }

  // A background that fails to load is skipped for the next one, trying each at most once per round; if none
  // loads, the current one stays for another hold.
  const prepare = async (): Promise<HTMLElement | undefined> => {
    for (let tries = 0; tries < slides.length; tries++) {
      const candidate = next()
      if (candidate === current) continue
      if (await load(candidate)) return candidate
    }
    return undefined
  }

  const continueAfter = (holdMs: number): void => {
    const ready = prepare()
    setTimeout(async () => {
      const upcoming = await ready
      const hold = between(...HOLD_MS)
      if (upcoming) show(upcoming, pick(TRANSITIONS), hold)
      continueAfter(hold)
    }, holdMs)
  }

  const first = next()
  await within(load(first), FIRST_IMAGE_PATIENCE_MS, false)
  const hold = between(...HOLD_MS)
  show(first, "crossfade", hold)
  continueAfter(hold)
}
