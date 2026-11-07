// Injected before the page's own scripts: a clock that moves only when the renderer steps it, so every timer,
// animation frame, CSS animation and video lands exactly on a frame of the recording.
(() => {
  let now = 0
  const realTimeout = window.setTimeout.bind(window)
  const realNow = Performance.prototype.now.bind(performance)
  const epoch = Date.now()
  performance.now = () => now
  Date.now = () => epoch + now

  let nextId = 1
  const timers = new Map()
  window.setTimeout = (callback, ms = 0, ...args) => {
    const id = nextId++
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), callback, args })
    return id
  }
  window.setInterval = (callback, ms = 0, ...args) => {
    const id = nextId++
    const every = Math.max(1, Number(ms) || 0)
    timers.set(id, { at: now + every, every, callback, args })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id)

  let frames = new Map()
  window.requestAnimationFrame = (callback) => {
    const id = nextId++
    frames.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => frames.delete(id)

  // A video "plays" on the clock: it stays paused in the browser and is seeked to its own time on every frame.
  const media = HTMLMediaElement.prototype
  const realPause = media.pause
  const clocks = new Map()
  Object.defineProperty(media, "paused", { get() { return !clocks.has(this) } })
  media.play = function () {
    if (!clocks.has(this)) {
      clocks.set(this, this.__seconds ?? 0)
      this.preload = "auto"
      if (this.readyState === 0 && this.networkState !== HTMLMediaElement.NETWORK_LOADING) this.load()
      const announce = () => {
        this.dispatchEvent(new Event("canplaythrough"))
        this.dispatchEvent(new Event("playing"))
      }
      if (this.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) queueMicrotask(announce)
      else this.addEventListener("canplay", announce, { once: true })
    }
    return Promise.resolve()
  }
  media.pause = function () {
    if (!clocks.has(this)) return
    this.__seconds = clocks.get(this)
    clocks.delete(this)
    realPause.call(this)
    this.dispatchEvent(new Event("pause"))
  }

  const born = new WeakMap()
  const settle = (video) => new Promise((resolve) => {
    const done = () => resolve()
    video.addEventListener("seeked", done, { once: true })
    realTimeout(done, 2000)
  })

  window.__clock = {
    now: () => now,
    // Moves the clock on by ms: timers fall due in order, then one animation frame runs, then every CSS animation
    // is set to its age and every video on screen is seeked to its time.
    async step(ms) {
      const target = now + ms
      for (;;) {
        let due
        for (const [id, timer] of timers) if (timer.at <= target && (!due || timer.at < due[1].at)) due = [id, timer]
        if (!due) break
        const [id, timer] = due
        now = Math.max(now, timer.at)
        if (timer.every) timer.at += timer.every
        else timers.delete(id)
        try { timer.callback(...timer.args) } catch (error) { console.error(error) }
        await Promise.resolve()
      }
      now = target
      for (const [video, seconds] of clocks) if (video.readyState > 0) clocks.set(video, seconds + ms / 1000)

      const seeks = []
      for (const [video, seconds] of clocks) {
        if (!video.closest(".slide")?.matches(".is-active, .is-leaving") || !video.duration) continue
        const at = seconds % video.duration
        if (Math.abs(video.currentTime - at) < 1e-4) continue
        video.currentTime = at
        seeks.push(settle(video))
      }
      const seekStart = realNow()
      await Promise.all(seeks)
      const seekMs = realNow() - seekStart

      const running = frames
      frames = new Map()
      for (const callback of running.values()) {
        try { callback(now) } catch (error) { console.error(error) }
      }
      for (const animation of document.getAnimations()) {
        if (!born.has(animation)) born.set(animation, now)
        animation.pause()
        animation.currentTime = now - born.get(animation)
      }
      return { seekMs, seeks: seeks.length }
    },
  }
})()
