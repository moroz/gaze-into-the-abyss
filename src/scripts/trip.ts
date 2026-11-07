// The trip overlay: the psychedelia shader, drawn into its own target for the stage to screen over the slides.
// On the site it draws small and at 24 fps (the stage stretches it); when rendering a video, at full size every frame.

import { alternating, easeInOut } from "./easing"
import { build, drawInto, sized, VERTEX_100, type Program, type Target } from "./gl"
import { randomStream } from "./random"
import { SCENES, sceneSchedule, type SceneMoment } from "./scene-schedule"

const RESOLUTION_SCALE = 0.75
const MAX_PIXELS = 1_000_000
const FRAME_INTERVAL_MS = 1000 / 24
const RANDOM_START_MS = 600_000
const TAU = 2 * Math.PI
// Its opacity breathes between these over BREATHE_S, from a random point in the cycle.
const BREATHE: [number, number] = [0.45, 1]
const BREATHE_S = 50
const STILL_OPACITY = 0.75

export interface TripOptions { still: boolean; rendering: boolean }

export class Trip {
  private program: Program | undefined
  private output: Target | undefined
  private drawnAt: number | undefined
  private readonly loaded: number
  private phase: number
  private tickedAt: number
  private readonly pace: (seconds: number) => number
  private readonly sceneAt: (seconds: number) => SceneMoment
  private readonly breatheOffset: number

  constructor(private fragment: string, private options: TripOptions) {
    const hash = new URLSearchParams(location.hash.slice(1))
    const chosenScene = SCENES.indexOf(hash.get("scene") as (typeof SCENES)[number])
    this.sceneAt = sceneSchedule(chosenScene >= 0 ? chosenScene : undefined)
    this.breatheOffset = randomStream("overlay").next() * 100
    const chosen = Number(hash.get("t"))
    this.loaded = performance.now()
    const started = this.loaded - (chosen > 0 ? chosen * 1000 : randomStream("shader time").next() * RANDOM_START_MS)
    // The scenes' clock runs at a pace that wanders between about half and one and a half times over minutes, so
    // the trip does not keep one tempo. It is seeded like everything else.
    const { next: paceRandom } = randomStream("overlay pace")
    const offsets = [paceRandom() * TAU, paceRandom() * TAU]
    this.pace = (seconds) => 1 + 0.3 * Math.sin((seconds * TAU) / 170 + offsets[0]) + 0.2 * Math.sin((seconds * TAU) / 61 + offsets[1])
    this.phase = (this.loaded - started) / 1000
    this.tickedAt = this.loaded
  }

  // After a lost context: everything GL goes, the clock and the schedule stay.
  reset(): void {
    this.program = undefined
    this.output = undefined
    this.drawnAt = undefined
  }

  opacity(now: number): number {
    if (this.options.still) return STILL_OPACITY
    const [low, high] = BREATHE
    return low + (high - low) * alternating((now - this.loaded) / 1000 + this.breatheOffset, BREATHE_S, easeInOut)
  }

  // Draws a new frame when one is due, and returns the target holding the latest.
  draw(gl: WebGL2RenderingContext, now: number, screenWidth: number, screenHeight: number, ratio: number): Target {
    const { rendering, still } = this.options
    const scale = (rendering ? 1 : RESOLUTION_SCALE) * ratio
    const wanted = screenWidth * screenHeight * scale * scale
    const capped = rendering ? scale : scale * Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, wanted)))
    const width = Math.max(1, Math.round(screenWidth * capped))
    const height = Math.max(1, Math.round(screenHeight * capped))
    const resized = !this.output || this.output.width !== width || this.output.height !== height
    this.output = sized(gl, this.output, width, height)
    if (!this.due(now) && !resized) return this.output

    this.program ??= build(gl, this.fragment, ["resolution", "time", "fromScene", "toScene", "blend", "transition"], VERTEX_100)
    const { program, uniforms } = this.program
    drawInto(gl, this.output, width, height)
    gl.useProgram(program)
    gl.uniform2f(uniforms.resolution, width, height)
    if (!still || this.drawnAt === undefined) {
      this.phase += (Math.min(now - this.tickedAt, 250) / 1000) * this.pace((now - this.loaded) / 1000)
      this.tickedAt = now
    }
    gl.uniform1f(uniforms.time, this.phase)
    const moment = this.sceneAt((now - this.loaded) / 1000)
    gl.uniform1f(uniforms.fromScene, moment.from)
    gl.uniform1f(uniforms.toScene, moment.to)
    gl.uniform1f(uniforms.blend, moment.blend)
    gl.uniform1f(uniforms.transition, moment.transition)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.output
  }

  private due(now: number): boolean {
    if (this.drawnAt === undefined) {
      this.drawnAt = now
      return true
    }
    if (this.options.still) return false
    if (this.options.rendering) return true
    const elapsed = now - this.drawnAt
    if (elapsed < FRAME_INTERVAL_MS - 2) return false
    this.drawnAt = now - (elapsed % FRAME_INTERVAL_MS)
    return true
  }
}
