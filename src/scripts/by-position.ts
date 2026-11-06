export const byPosition = (a: { data: { position: number } }, b: { data: { position: number } }): number =>
  a.data.position - b.data.position
