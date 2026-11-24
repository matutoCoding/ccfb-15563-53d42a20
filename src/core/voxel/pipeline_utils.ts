import { distanceToSurface, voxelIndex } from '../grid_utils'
import type { VoxelVolume } from '../types'

/**
 * 洪水填充：从网格边界的空格出发 BFS，能到达的空都是「外部」
 * 到达不了的封闭空腔标记为实心（occupancy=1），让薄壳模型内部被填满
 */
export const fillInterior = (vol: VoxelVolume): void => {
  const { size, occupancy } = vol
  const n = occupancy.length
  const visited = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  const pushBoundary = (x: number, y: number, z: number): void => {
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) return
    const idx = voxelIndex(size, x, y, z)
    if (occupancy[idx] === 0 && !visited[idx]) {
      visited[idx] = 1
      queue[tail++] = idx
    }
  }

  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      pushBoundary(x, y, 0)
      pushBoundary(x, y, size[2] - 1)
    }
  }
  for (let x = 0; x < size[0]; x++) {
    for (let z = 0; z < size[2]; z++) {
      pushBoundary(x, 0, z)
      pushBoundary(x, size[1] - 1, z)
    }
  }
  for (let y = 0; y < size[1]; y++) {
    for (let z = 0; z < size[2]; z++) {
      pushBoundary(0, y, z)
      pushBoundary(size[0] - 1, y, z)
    }
  }

  const nx = size[0]
  const layer = size[0] * size[1]
  while (head < tail) {
    const idx = queue[head++]
    const candidates = [idx + 1, idx - 1, idx + nx, idx - nx, idx + layer, idx - layer]
    for (const nb of candidates) {
      if (nb < 0 || nb >= n || visited[nb] || occupancy[nb] !== 0) continue
      visited[nb] = 1
      queue[tail++] = nb
    }
  }

  // 未被外部访问到的空格 = 封闭空腔，填实
  for (let idx = 0; idx < n; idx++) {
    if (occupancy[idx] === 0 && !visited[idx]) occupancy[idx] = 1
  }
}

/**
 * 内部加强筋间距（格）。掏空时每隔该间距保留一层实体网格墙，
 * 把巨大内腔切成砖可跨越的小腔（与最大砖 2x4 的跨距匹配），
 * 支撑柱只需连接到相邻筋墙而非贯穿整个模型，兼顾省料与可搭建性。
 */
const RIB_SPACING = 8

/**
 * 等厚掏空 + 加强筋：
 *  - dist < shellThickness 的体素保留为外壳
 *  - 落在 RIB_SPACING 网格面上的内部体素保留为加强筋
 *  - 其余标记为 occupancy=2（掏空）。薄颈处 dist 恒小于壳厚，天然不会被切断
 */
export const hollowShell = (vol: VoxelVolume, shellThickness: number): number => {
  const dist = distanceToSurface(vol)
  const [sx, sy, sz] = vol.size
  let removed = 0
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const idx = voxelIndex(vol.size, x, y, z)
        if (vol.occupancy[idx] !== 1 || dist[idx] < shellThickness) continue
        // 加强筋：三个轴向上落在网格面的体素保留，形成内部蜂窝骨架
        const onRib =
          x % RIB_SPACING === 0 ||
          y % RIB_SPACING === 0 ||
          z % RIB_SPACING === 0
        if (onRib) continue
        vol.occupancy[idx] = 2
        removed++
      }
    }
  }
  vol.stats.hollowed = removed
  vol.stats.shellThickness = shellThickness
  return removed
}

/** 计算网格尺寸与世界包围盒，最长边对齐目标分辨率 */
export const computeGrid = (
  meshMin: [number, number, number],
  meshMax: [number, number, number],
  resolution: number,
): {
  size: [number, number, number]
  voxelSize: number
  origin: [number, number, number]
} => {
  const span: [number, number, number] = [
    meshMax[0] - meshMin[0],
    meshMax[1] - meshMin[1],
    meshMax[2] - meshMin[2],
  ]
  const longest = Math.max(span[0], span[1], span[2])
  const voxelSize = longest / resolution
  const size: [number, number, number] = [
    Math.max(1, Math.round(span[0] / voxelSize)),
    Math.max(1, Math.round(span[1] / voxelSize)),
    Math.max(1, Math.round(span[2] / voxelSize)),
  ]
  // 网格略大于包围盒，避免边界三角被裁
  const origin: [number, number, number] = [
    meshMin[0] - voxelSize * 0.5,
    meshMin[1] - voxelSize * 0.5,
    meshMin[2] - voxelSize * 0.5,
  ]
  return { size, voxelSize, origin }
}

export const meshBounds = (
  positions: Float32Array,
): { min: [number, number, number]; max: [number, number, number] } => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}
