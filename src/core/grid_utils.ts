import type { VoxelVolume } from './types'

export type Dim3 = [number, number, number]

export const voxelIndex = (size: Dim3, x: number, y: number, z: number): number =>
  x + size[0] * (y + size[1] * z)

export const inBounds = (size: Dim3, x: number, y: number, z: number): boolean =>
  x >= 0 &&
  y >= 0 &&
  z >= 0 &&
  x < size[0] &&
  y < size[1] &&
  z < size[2]

export const isSolid = (vol: VoxelVolume, x: number, y: number, z: number): boolean => {
  if (!inBounds(vol.size, x, y, z)) return false
  return vol.occupancy[voxelIndex(vol.size, x, y, z)] === 1
}

/** 体素中心的世界坐标（Three.js 坐标系，z 轴向上映射为世界 y 轴） */
export const voxelToWorld = (
  vol: VoxelVolume,
  x: number,
  y: number,
  z: number,
): [number, number, number] => {
  const s = vol.voxelMm
  return [
    (x - (vol.size[0] - 1) / 2) * s + vol.origin[0],
    (z - (vol.size[2] - 1) / 2) * s + vol.origin[1],
    (y - (vol.size[1] - 1) / 2) * s + vol.origin[2],
  ]
}

export const createVolume = (
  size: Dim3,
  voxelMm: number,
  origin: Dim3 = [0, 0, 0],
): VoxelVolume => {
  const total = size[0] * size[1] * size[2]
  return {
    size,
    occupancy: new Uint8Array(total),
    colorIndex: new Uint8Array(total).fill(255),
    sampleRGB: new Uint8Array(total * 3),
    voxelMm,
    origin,
    stats: {
      total: 0,
      surface: 0,
      hollowed: 0,
      maxResolution: Math.max(...size),
      shellThickness: 0,
      engine: 'cpu',
      elapsedMs: 0,
    },
  }
}

/** 统计实心/表面数量，并把未采样的内部体素填上邻居色，避免黑色窟窿 */
export const finalizeVolume = (vol: VoxelVolume): void => {
  let total = 0
  let surface = 0
  const { size, occupancy } = vol
  for (let z = 0; z < size[2]; z++) {
    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        const idx = voxelIndex(size, x, y, z)
        if (occupancy[idx] !== 1) continue
        total++
        const exposed =
          !inBounds(size, x + 1, y, z) ||
          occupancy[voxelIndex(size, x + 1, y, z)] === 0 ||
          !inBounds(size, x - 1, y, z) ||
          occupancy[voxelIndex(size, x - 1, y, z)] === 0 ||
          !inBounds(size, x, y + 1, z) ||
          occupancy[voxelIndex(size, x, y + 1, z)] === 0 ||
          !inBounds(size, x, y - 1, z) ||
          occupancy[voxelIndex(size, x, y - 1, z)] === 0 ||
          !inBounds(size, x, y, z + 1) ||
          occupancy[voxelIndex(size, x, y, z + 1)] === 0 ||
          !inBounds(size, x, y, z - 1) ||
          occupancy[voxelIndex(size, x, y, z - 1)] === 0
        if (exposed) surface++
      }
    }
  }
  vol.stats.total = total
  vol.stats.surface = surface
}

/** 多源 BFS：计算每个实心体素到最近表面的距离（6 邻接），用于等厚掏空 */
export const distanceToSurface = (vol: VoxelVolume): Int32Array => {
  const { size, occupancy } = vol
  const n = occupancy.length
  const dist = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  for (let idx = 0; idx < n; idx++) {
    if (occupancy[idx] !== 1) continue
    const x = idx % size[0]
    const y = Math.floor(idx / size[0]) % size[1]
    const z = Math.floor(idx / (size[0] * size[1]))
    const exposed =
      x === 0 ||
      y === 0 ||
      z === 0 ||
      x === size[0] - 1 ||
      y === size[1] - 1 ||
      z === size[2] - 1 ||
      occupancy[idx + 1] === 0 ||
      occupancy[idx - 1] === 0 ||
      occupancy[idx + size[0]] === 0 ||
      occupancy[idx - size[0]] === 0 ||
      occupancy[idx + size[0] * size[1]] === 0 ||
      occupancy[idx - size[0] * size[1]] === 0
    if (exposed) {
      dist[idx] = 0
      queue[tail++] = idx
    }
  }

  const nx = size[0]
  const layer = size[0] * size[1]
  while (head < tail) {
    const idx = queue[head++]
    const nd = dist[idx] + 1
    const neighbors = [
      idx + 1,
      idx - 1,
      idx + nx,
      idx - nx,
      idx + layer,
      idx - layer,
    ]
    for (const nb of neighbors) {
      if (nb < 0 || nb >= n || occupancy[nb] !== 1 || dist[nb] !== -1) continue
      dist[nb] = nd
      queue[tail++] = nb
    }
  }
  return dist
}
