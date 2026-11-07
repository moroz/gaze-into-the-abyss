// Injected before the page's own scripts: a clock that moves only when the renderer steps it, so every timer and
// animation frame lands exactly on a frame of the recording. The stage (src/scripts/stage.ts, in #render mode) does
// the rest: it waits for loads and decodes each video frame in window.__abyss.beforeFrame.
(() => {
  let now = 0
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

  // Lets promise chains a timer started run to their end, as they would between two real frames.
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  window.__clock = {
    now: () => now,
    // Wall-clock time, for the renderer's own timings.
    realNow,
    // Moves the clock on by ms: timers fall due in order, the stage gets what it needs, then one animation frame runs.
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
        await settle()
      }
      now = target
      await settle()
      await window.__abyss?.beforeFrame()
      await settle()
      const running = frames
      frames = new Map()
      for (const callback of running.values()) {
        try { callback(now) } catch (error) { console.error(error) }
      }
    },
  }
})()
