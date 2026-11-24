export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v))

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`

export const formatNumber = (n: number): string => n.toLocaleString('zh-CN')

export const formatMs = (ms: number): string =>
  ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`

/** 线性 rgb -> 感知近似 Lab（绕开开方，足够最近色匹配） */
export const rgbToLab = (r: number, g: number, b: number): [number, number, number] => {
  const toLinear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  // XYZ, D65
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883
  const f = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 色差，值越小越接近 */
export const colorDistance = (
  a: [number, number, number],
  b: [number, number, number],
): number => {
  const dl = a[0] - b[0]
  const dm = a[1] - b[1]
  const ds = a[2] - b[2]
  return Math.sqrt(dl * dl + dm * dm + ds * ds)
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')}`

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
