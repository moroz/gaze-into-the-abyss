// CSS timing functions, so the stage's fades and drifts follow the curves the stylesheet used to give them.

export type Easing = (x: number) => number

// cubic-bezier(x1, y1, x2, y2): solve the curve's x for the parameter, then read its y.
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Easing => {
  const at = (a: number, b: number, t: number): number => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t
  const slope = (a: number, b: number, t: number): number => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const error = at(x1, x2, t) - x
      const d = slope(x1, x2, t)
      if (Math.abs(error) < 1e-6) break
      if (Math.abs(d) < 1e-6) break
      t -= error / d
    }
    // Newton can stall on a flat stretch; bisection finishes the job.
    if (Math.abs(at(x1, x2, t) - x) > 1e-5) {
      let low = 0
      let high = 1
      t = x
      for (let i = 0; i < 30; i++) {
        if (at(x1, x2, t) < x) low = t
        else high = t
        t = (low + high) / 2
      }
    }
    return at(y1, y2, t)
  }
}

export const linear: Easing = (x) => Math.min(1, Math.max(0, x))
export const ease = cubicBezier(0.25, 0.1, 0.25, 1)
export const easeIn = cubicBezier(0.42, 0, 1, 1)
export const easeOut = cubicBezier(0, 0, 0.58, 1)
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1)

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// Progress through an infinite animation of the given period that alternates direction, as
// "animation: … infinite alternate" runs it, eased within each pass.
export const alternating = (seconds: number, period: number, easing: Easing): number => {
  const passes = seconds / period
  const pass = Math.floor(passes)
  const within = passes - pass
  return easing(pass % 2 === 0 ? within : 1 - within)
}

// Progress through an infinite linear loop: 0..1, wrapping.
export const looping = (seconds: number, period: number): number => {
  const passes = seconds / period
  return passes - Math.floor(passes)
}
