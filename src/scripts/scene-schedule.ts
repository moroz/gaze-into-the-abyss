import { randomStream } from "./random"

export const SCENES = ["liquid", "nebula", "lattice", "fractal"] as const
export const TRANSITIONS = ["crossfade", "bloom", "ink", "petals"] as const

const HOLD_SECONDS: [number, number] = [30, 55]
const FADE_SECONDS: [number, number] = [6, 14]

interface Segment {
  scene: number
  start: number
  end: number
  fade: number
  transition: number
}

export interface SceneMoment {
  from: number
  to: number
  blend: number
  transition: number
}

const easeInOut = (x: number): number => x * x * (3 - 2 * x)

export function sceneSchedule(firstScene?: number): (seconds: number) => SceneMoment {
  const { between, pick, shuffledForever } = randomStream("scenes")
  const nextScene = shuffledForever(SCENES.map((_, index) => index), firstScene)
  const opening = nextScene()
  const segments: Segment[] = [{ scene: opening, start: 0, end: between(...HOLD_SECONDS), fade: 0, transition: 0 }]

  const segmentAt = (seconds: number): number => {
    while (segments[segments.length - 1].end <= seconds) {
      const last = segments[segments.length - 1]
      segments.push({
        scene: nextScene(),
        start: last.end,
        end: last.end + between(...HOLD_SECONDS),
        fade: between(...FADE_SECONDS),
        transition: TRANSITIONS.indexOf(pick(TRANSITIONS)),
      })
    }
    let index = segments.length - 1
    while (segments[index].start > seconds) index--
    return index
  }

  return (seconds) => {
    const elapsed = Math.max(0, seconds)
    const index = segmentAt(elapsed)
    const segment = segments[index]
    const into = elapsed - segment.start
    if (index === 0 || into >= segment.fade) return { from: segment.scene, to: segment.scene, blend: 1, transition: 0 }
    return { from: segments[index - 1].scene, to: segment.scene, blend: easeInOut(into / segment.fade), transition: segment.transition }
  }
}
