const SEED_KEY = "__abyssSeed"

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5
  for (const character of text) {
    hash ^= character.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let mixed = Math.imul(seed ^ (seed >>> 15), seed | 1)
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
}

const freshSeed = (): string => crypto.getRandomValues(new Uint32Array(1))[0].toString(36)

const resolveSeed = (): string => {
  const holder = globalThis as typeof globalThis & { [SEED_KEY]?: string }
  if (!holder[SEED_KEY]) {
    const chosen = new URLSearchParams(location.hash.slice(1)).get("seed")
    holder[SEED_KEY] = chosen || freshSeed()
    console.info(`Gaze into the Abyss: add #seed=${holder[SEED_KEY]} to the URL to replay this visit.`)
  }
  return holder[SEED_KEY]
}

export interface RandomStream {
  next: () => number
  between: (low: number, high: number) => number
  pick: <T>(items: readonly T[]) => T
  shuffled: <T>(items: readonly T[]) => T[]
  shuffledForever: <T>(items: readonly T[], first?: T) => () => T
}

export function randomStream(name: string): RandomStream {
  const next = mulberry32(fnv1a(`${resolveSeed()}/${name}`))

  const between = (low: number, high: number): number => low + next() * (high - low)

  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]

  const shuffled = <T>(items: readonly T[]): T[] => {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(next() * (index + 1))
      ;[copy[index], copy[other]] = [copy[other], copy[index]]
    }
    return copy
  }

  const shuffledForever = <T>(items: readonly T[], first?: T): (() => T) => {
    let queue: T[] = first === undefined ? [] : [first, ...shuffled(items.filter((item) => item !== first))]
    let previous: T | undefined
    return () => {
      if (queue.length === 0) {
        queue = shuffled(items)
        if (queue.length > 1 && queue[0] === previous) [queue[0], queue[1]] = [queue[1], queue[0]]
      }
      previous = queue.shift()!
      return previous
    }
  }

  return { next, between, pick, shuffled, shuffledForever }
}
