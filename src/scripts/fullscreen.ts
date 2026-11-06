type WebKitDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type WebKitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

const page = document as WebKitDocument
const root = document.documentElement as WebKitElement

const supported = (): boolean => Boolean(page.fullscreenEnabled || page.webkitFullscreenEnabled)
const active = (): boolean => Boolean(page.fullscreenElement || page.webkitFullscreenElement)

const enter = (): void => {
  if (root.requestFullscreen) root.requestFullscreen().catch(() => {})
  else root.webkitRequestFullscreen?.()
}

const exit = (): void => {
  if (page.exitFullscreen) page.exitFullscreen().catch(() => {})
  else page.webkitExitFullscreen?.()
}

export function runFullscreenToggle(button: HTMLButtonElement): void {
  if (!supported()) return
  const render = (): void => {
    button.setAttribute("aria-label", active() ? "Exit full screen" : "Full screen")
    button.classList.toggle("is-active", active())
  }
  button.hidden = false
  button.addEventListener("click", () => (active() ? exit() : enter()))
  document.addEventListener("fullscreenchange", render)
  document.addEventListener("webkitfullscreenchange", render)
  render()
}
