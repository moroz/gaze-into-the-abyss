const FADE_IN_MS = 3000
const FULL_VOLUME = 0.8
const PRELOAD_NEXT_SECONDS = 30
const HINT_MS = 6000
const HINT_FADE_MS = 800
const BLOCKED_CHECK_MS = 2000

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function runSoundtrack(audio: HTMLAudioElement, tracks: string[], toggle: HTMLButtonElement, hint: HTMLElement, first?: string): void {
  let current = ""
  let queue: string[] = []
  let prefetched = ""
  let audible = false
  let attempt = 0
  let fadeFrame = 0
  let hintTimer = 0
  let blockedCheck = 0
  let failures = 0

  // Every pass plays each track once in a fresh order, and a new pass never opens with the track that closed the last.
  const upcoming = (): string => {
    if (queue.length === 0) {
      queue = shuffled(tracks)
      if (queue.length > 1 && queue[0] === current) [queue[0], queue[1]] = [queue[1], queue[0]]
    }
    return queue[0]
  }

  const advance = (): void => {
    current = upcoming()
    queue.shift()
    audio.src = current
  }

  const begin = (): void => {
    if (!first) return advance()
    current = first
    audio.src = current
  }

  const render = (): void => {
    toggle.setAttribute("aria-label", audible ? "Pause music" : "Play music")
    toggle.classList.toggle("is-playing", audible)
  }

  const fadeIn = (): void => {
    cancelAnimationFrame(fadeFrame)
    const started = performance.now()
    const step = (now: number): void => {
      const progress = Math.min(1, Math.max(0, (now - started) / FADE_IN_MS))
      audio.volume = FULL_VOLUME * progress
      if (progress < 1) fadeFrame = requestAnimationFrame(step)
    }
    fadeFrame = requestAnimationFrame(step)
  }

  const showHint = (): void => {
    clearTimeout(hintTimer)
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

  // iOS fires no click for a tap on something that does not look clickable, but its touchend still lets audio start.
  const GESTURES = ["click", "touchend", "keydown"]

  const startOnGesture = (event: Event): void => {
    if (audible || toggle.contains(event.target as Node)) return
    play()
  }

  const waitForGesture = (): void => {
    for (const gesture of GESTURES) window.addEventListener(gesture, startOnGesture)
  }

  const stopWaitingForGesture = (): void => {
    for (const gesture of GESTURES) window.removeEventListener(gesture, startOnGesture)
  }

  const stop = (): void => {
    clearTimeout(blockedCheck)
    attempt += 1
    cancelAnimationFrame(fadeFrame)
    audio.pause()
  }

  const blocked = (): void => {
    stop()
    audible = false
    render()
    waitForGesture()
    showHint()
  }

  const checkStillBlocked = (thisAttempt: number): void => {
    blockedCheck = window.setTimeout(() => {
      if (thisAttempt !== attempt || audible) return
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) blocked()
      else checkStillBlocked(thisAttempt)
    }, BLOCKED_CHECK_MS)
  }

  const play = (): void => {
    clearTimeout(blockedCheck)
    const thisAttempt = ++attempt
    audio.volume = 0
    audio.play().catch(() => {
      if (thisAttempt === attempt) blocked()
    })
    checkStillBlocked(thisAttempt)
  }

  const pause = (): void => {
    stop()
    audible = false
    render()
  }

  const onPlaying = (): void => {
    clearTimeout(blockedCheck)
    failures = 0
    if (audible) return
    audible = true
    render()
    hideHint()
    stopWaitingForGesture()
    fadeIn()
  }

  const onPause = (): void => {
    if (audible && !audio.ended) blocked()
  }

  const next = (): void => {
    const continuing = audible
    advance()
    audible = false
    if (continuing) play()
    else render()
  }

  // A track that will not load would otherwise fail every play() as if autoplay were blocked, ignoring every click.
  const skipBroken = (): void => {
    failures += 1
    if (failures >= tracks.length) return
    advance()
    play()
  }

  const prefetchNext = (): void => {
    if (prefetched === upcoming() || audio.duration - audio.currentTime > PRELOAD_NEXT_SECONDS) return
    prefetched = upcoming()
    fetch(prefetched).catch(() => {})
  }

  audio.addEventListener("playing", onPlaying)
  audio.addEventListener("pause", onPause)
  audio.addEventListener("ended", next)
  audio.addEventListener("error", skipBroken)
  audio.addEventListener("timeupdate", prefetchNext)
  toggle.addEventListener("click", () => (audible ? pause() : play()))
  begin()
  render()
  play()
}
