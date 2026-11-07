import { randomStream } from "./random"
import { VIDEO_EFFECTS, type VideoEffect } from "./video-warp"

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
    // The first background can be on screen before it is ready; a slow one there keeps playing.
    if (!playable && !video.closest(".slide")?.classList.contains("is-active")) video.pause()
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
  // Each showing gets its own pace, which scales the slide's colour cycles and its video's warp, and a video its own
  // strength of distortion around the entry's setting.
  const paces = randomStream("background pace")
  const distortions = randomStream("distortion")

  // Each time a video comes on screen it gets one effect, from its own list where it has one (data-effects);
  // #effect=<name> holds every video to that one.
  const effects = randomStream("video effects")
  const chosenEffect = new URLSearchParams(location.hash.slice(1)).get("effect") as VideoEffect | null
  const effectFor = (video: HTMLVideoElement): VideoEffect => {
    if (chosenEffect && VIDEO_EFFECTS.includes(chosenEffect)) return chosenEffect
    const suited = (video.dataset.effects?.split(" ") ?? []).filter((name): name is VideoEffect => VIDEO_EFFECTS.includes(name as VideoEffect))
    return effects.pick(suited.length ? suited : VIDEO_EFFECTS)
  }
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
    arriving.style.setProperty("--pace", paces.between(0.6, 1.6).toFixed(2))
    arriving.style.setProperty("--drift-ms", `${holdMs + TRANSITION_MS[transition]}ms`)
    void arriving.offsetWidth
    arriving.classList.add("is-active")
    const picture = pictureOf(arriving)
    if (picture instanceof HTMLVideoElement) {
      picture.dataset.effect = effectFor(picture)
      picture.dataset.strength = (Number(picture.dataset.distortion ?? 1) * distortions.between(0.6, 1.25)).toFixed(2)
      picture.dataset.pace = arriving.style.getPropertyValue("--pace")
      picture.play().catch(() => {})
    }
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

  // The first background gets FIRST_IMAGE_PATIENCE_MS under the dark veil. One that is merely slow is shown and
  // goes on loading; one that fails outright gives way to the next that loads.
  let first = next()
  const outcome = await within(load(first).then((ok) => (ok ? "loaded" : "failed")), FIRST_IMAGE_PATIENCE_MS, "slow")
  if (outcome === "failed") first = (await prepare()) ?? first
  const hold = between(...HOLD_MS)
  show(first, "crossfade", hold)
  continueAfter(hold)
}
