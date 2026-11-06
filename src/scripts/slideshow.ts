const CROSSFADE_MS = 4000

export function runSlideshow(slides: HTMLElement[], secondsPerSlide: number): void {
  let index = 0
  let settleTimer = 0

  const load = (position: number): void => {
    const image = slides[position % slides.length].querySelector("img")
    if (!image || image.getAttribute("srcset")) return
    image.srcset = image.dataset.srcset ?? ""
    image.src = image.dataset.src ?? ""
  }

  const show = (incoming: number): void => {
    slides[index].classList.replace("is-active", "is-leaving")
    const arriving = slides[incoming]
    load(incoming)
    arriving.classList.remove("is-leaving")
    void arriving.offsetWidth
    arriving.classList.add("is-active")
    index = incoming
    load(incoming + 1)
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => slides.forEach((slide) => slide.classList.remove("is-leaving")), CROSSFADE_MS)
  }

  load(1)
  window.setInterval(() => show((index + 1) % slides.length), secondsPerSlide * 1000)
}
