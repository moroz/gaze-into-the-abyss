// How hard the stage trips: which backgrounds it shows and for how long, how it bends and colours them, and how
// much of the trip overlay comes through. #mood=<name> picks one; without it the site runs "abyss", as it always has.
//   abyss  every background, every effect and overlay scene
//   rain   calmer, for a rain video: only wildlife and landscapes, held longer, barely bent (rippled or folded in a
//          kaleidoscope), no hue drift, a faint overlay

import type { Subject, Transition } from "./slideshow"
import type { SCENES } from "./scene-schedule"
import type { VideoEffect } from "./video-warp"

export interface Mood {
  // undefined shows every background.
  subjects?: Subject[]
  holdMs: [number, number]
  transitions: Transition[]
  // undefined lets each video draw from its own list or all of them.
  effects?: VideoEffect[]
  // Scales every video's distortion.
  distortion: number
  scenes: (typeof SCENES)[number][]
  // The overlay's opacity breathes between these.
  breathe: [number, number]
  // soft drops the hue drift and most of the oversaturation.
  colour: "full" | "soft"
}

const MOODS = {
  abyss: {
    holdMs: [18_000, 32_000],
    transitions: ["crossfade", "through-black", "bloom", "dissolve"],
    distortion: 1,
    scenes: ["liquid", "nebula", "lattice"],
    breathe: [0.45, 1],
    colour: "full",
  },
  rain: {
    subjects: ["wildlife", "landscape"],
    holdMs: [40_000, 65_000],
    transitions: ["crossfade", "dissolve"],
    effects: ["ripple", "kaleidoscope"],
    distortion: 0.45,
    scenes: ["liquid", "nebula", "lattice"],
    breathe: [0.12, 0.32],
    colour: "soft",
  },
} satisfies Record<string, Mood>

export const mood: Mood = MOODS[new URLSearchParams(location.hash.slice(1)).get("mood") as keyof typeof MOODS] ?? MOODS.abyss
