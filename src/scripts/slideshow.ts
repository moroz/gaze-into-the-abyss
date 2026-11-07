import { between, pick, shuffledForever } from "./random"

const HOLD_MS: [number, number] = [18_000, 32_000]
const FIRST_IMAGE_PATIENCE_MS = 6_000

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

const load = async (slide: HTMLElement): Promise<void> => {
  const image = slide.querySelector("img")!
  if (!image.getAttribute("srcset")) {
    image.srcset = image.dataset.srcset ?? ""
    image.src = image.dataset.src ?? ""
  }
  await image.decode().catch(() => {})
}

const within = async (promise: Promise<void>, ms: number): Promise<void> => {
  await Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
}

export async function runSlideshow(container: HTMLElement, slides: HTMLElement[]): Promise<void> {
  const next = shuffledForever(slides)
  let current: HTMLElement | undefined

  container.style.animationDelay = `-${Math.random() * 180}s`

  const show = (arriving: HTMLElement, transition: Transition, holdMs: number): void => {
    const leaving = current
    if (leaving) {
      leaving.dataset.transition = transition
      leaving.classList.replace("is-active", "is-leaving")
      setTimeout(() => leaving.classList.remove("is-leaving"), TRANSITION_MS[transition])
    }
    const [from, to] = pick(DRIFTS)
    arriving.classList.remove("is-leaving", "is-active")
    arriving.dataset.transition = transition
    arriving.style.setProperty("--from", from)
    arriving.style.setProperty("--to", to)
    arriving.style.setProperty("--drift-ms", `${holdMs + TRANSITION_MS[transition]}ms`)
    void arriving.offsetWidth
    arriving.classList.add("is-active")
    current = arriving
  }

  const continueAfter = (holdMs: number): void => {
    const upcoming = next()
    const ready = load(upcoming)
    setTimeout(async () => {
      await ready
      const hold = between(...HOLD_MS)
      show(upcoming, pick(TRANSITIONS), hold)
      continueAfter(hold)
    }, holdMs)
  }

  const first = next()
  await within(load(first), FIRST_IMAGE_PATIENCE_MS)
  const hold = between(...HOLD_MS)
  show(first, "crossfade", hold)
  continueAfter(hold)
}
