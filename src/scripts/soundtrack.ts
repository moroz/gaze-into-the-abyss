const FADE_MS = 3000
const FULL_VOLUME = 0.8
const PRELOAD_NEXT_SECONDS = 30
const HINT_MS = 6000
const HINT_FADE_MS = 800

export function runSoundtrack(tracks: HTMLAudioElement[], toggle: HTMLButtonElement, hint: HTMLElement): void {
  let track = 0
  let playing = false
  let hinted = false
  let fadeFrame = 0
  let hintTimer = 0

  const current = (): HTMLAudioElement => tracks[track]
  const upcoming = (): HTMLAudioElement => tracks[(track + 1) % tracks.length]

  const render = (): void => {
    toggle.setAttribute("aria-label", playing ? "Pause music" : "Play music")
    toggle.classList.toggle("is-playing", playing)
  }

  const fadeTo = (target: number, done: () => void = () => {}): void => {
    cancelAnimationFrame(fadeFrame)
    const audio = current()
    const from = audio.volume
    const started = performance.now()
    const step = (now: number): void => {
      const progress = Math.min(1, Math.max(0, (now - started) / FADE_MS))
      audio.volume = from + (target - from) * progress
      if (progress < 1) fadeFrame = requestAnimationFrame(step)
      else done()
    }
    fadeFrame = requestAnimationFrame(step)
  }

  const showHintOnce = (): void => {
    if (hinted) return
    hinted = true
    hint.hidden = false
    requestAnimationFrame(() => hint.classList.add("is-showing"))
    hintTimer = window.setTimeout(hideHint, HINT_MS)
  }

  const hideHint = (): void => {
    if (!hint.classList.contains("is-showing")) return
    clearTimeout(hintTimer)
    hint.classList.remove("is-showing")
    hintTimer = window.setTimeout(() => { hint.hidden = true }, HINT_FADE_MS)
  }

  const startOnFirstGesture = (event: Event): void => {
    if (toggle.contains(event.target as Node)) return
    fadeIn()
  }

  const waitForGesture = (): void => {
    window.addEventListener("pointerdown", startOnFirstGesture)
    window.addEventListener("keydown", startOnFirstGesture)
  }

  const stopWaitingForGesture = (): void => {
    window.removeEventListener("pointerdown", startOnFirstGesture)
    window.removeEventListener("keydown", startOnFirstGesture)
  }

  const fadeIn = (): void => {
    hideHint()
    stopWaitingForGesture()
    playing = true
    render()
    current().volume = 0
    current().play().then(() => fadeTo(FULL_VOLUME), () => {
      playing = false
      render()
      waitForGesture()
      showHintOnce()
    })
  }

  const fadeOut = (): void => {
    playing = false
    render()
    const fading = current()
    fadeTo(0, () => fading.pause())
  }

  const next = (): void => {
    track = (track + 1) % tracks.length
    current().currentTime = 0
    current().volume = FULL_VOLUME
    if (playing) current().play().catch(() => {})
  }

  const prepareNext = (event: Event): void => {
    if (event.target !== current() || upcoming().preload === "auto") return
    if (current().duration - current().currentTime > PRELOAD_NEXT_SECONDS) return
    upcoming().preload = "auto"
    upcoming().load()
  }

  for (const audio of tracks) {
    audio.addEventListener("ended", next)
    audio.addEventListener("timeupdate", prepareNext)
  }
  toggle.addEventListener("click", () => (playing ? fadeOut() : fadeIn()))
  fadeIn()
}
