const IDLE_MS = 3500

export function fadeChromeWhenIdle(stage: HTMLElement): void {
  let idleTimer = 0
  const wake = (): void => {
    stage.classList.remove("is-idle")
    clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => stage.classList.add("is-idle"), IDLE_MS)
  }
  for (const event of ["pointermove", "pointerdown", "keydown"]) window.addEventListener(event, wake)
  wake()
}

export function keepScreenAwake(): void {
  let wakeLock: WakeLockSentinel | undefined
  const request = (): void => {
    if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return
    if (wakeLock && !wakeLock.released) return
    navigator.wakeLock.request("screen").then((lock) => { wakeLock = lock }, () => {})
  }
  document.addEventListener("visibilitychange", request)
  request()
}
