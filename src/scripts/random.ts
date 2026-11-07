export const between = (low: number, high: number): number => low + Math.random() * (high - low)

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]

const shuffled = <T>(items: readonly T[]): T[] => {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

export function shuffledForever<T>(items: readonly T[], first?: T): () => T {
  let queue: T[] = []
  let previous: T | undefined
  if (first !== undefined) queue = [first, ...shuffled(items.filter((item) => item !== first))]
  return () => {
    if (queue.length === 0) {
      queue = shuffled(items)
      if (queue.length > 1 && queue[0] === previous) [queue[0], queue[1]] = [queue[1], queue[0]]
    }
    previous = queue.shift()!
    return previous
  }
}
