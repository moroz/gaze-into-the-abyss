// The CSS filter functions the pictures were coloured with, as the affine colour matrices the Filter Effects spec
// defines them by. The stage applies them in order, clamping between each, as a browser does.

export interface ColourStep { matrix: number[]; offset: [number, number, number] }

// Column-major 3×3, ready for uniformMatrix3fv.
const fromRows = (rows: number[]): number[] => [rows[0], rows[3], rows[6], rows[1], rows[4], rows[7], rows[2], rows[5], rows[8]]

export const brightness = (amount: number): ColourStep => ({ matrix: fromRows([amount, 0, 0, 0, amount, 0, 0, 0, amount]), offset: [0, 0, 0] })

export const contrast = (amount: number): ColourStep => {
  const shift = 0.5 * (1 - amount)
  return { matrix: fromRows([amount, 0, 0, 0, amount, 0, 0, 0, amount]), offset: [shift, shift, shift] }
}

export const saturate = (s: number): ColourStep => ({
  matrix: fromRows([
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ]),
  offset: [0, 0, 0],
})

export const hueRotate = (degrees: number): ColourStep => {
  const angle = (degrees * Math.PI) / 180
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return {
    matrix: fromRows([
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ]),
    offset: [0, 0, 0],
  }
}
