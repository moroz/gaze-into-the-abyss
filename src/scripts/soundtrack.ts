const FADE_IN_MS = 3000
const FULL_VOLUME = 0.8
const PRELOAD_NEXT_SECONDS = 30
const HINT_MS = 6000
const HINT_FADE_MS = 800
const BLOCKED_CHECK_MS = 2000

export function runSoundtrack(audio: HTMLAudioElement, tracks: string[], toggle: HTMLButtonElement, hint: HTMLElement): void {
  let track = 0
  let prefetched = -1
  let audible = false
  let attempt = 0
  let fadeFrame = 0
  let hintTimer = 0
  let blockedCheck = 0

  const upcoming = (): number => (track + 1) % tracks.length

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

  const startOnGesture = (event: Event): void => {
    if (toggle.contains(event.target as Node)) return
    play()
  }

  const waitForGesture = (): void => {
    window.addEventListener("click", startOnGesture)
    window.addEventListener("keydown", startOnGesture)
  }

  const stopWaitingForGesture = (): void => {
    window.removeEventListener("click", startOnGesture)
    window.removeEventListener("keydown", startOnGesture)
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
    track = upcoming()
    audio.src = tracks[track]
    audible = false
    if (continuing) play()
    else render()
  }

  const prefetchNext = (): void => {
    if (prefetched === upcoming() || audio.duration - audio.currentTime > PRELOAD_NEXT_SECONDS) return
    prefetched = upcoming()
    fetch(tracks[prefetched]).catch(() => {})
  }

  audio.addEventListener("playing", onPlaying)
  audio.addEventListener("pause", onPause)
  audio.addEventListener("ended", next)
  audio.addEventListener("timeupdate", prefetchNext)
  toggle.addEventListener("click", () => (audible ? pause() : play()))
  render()
  play()
}
