import { createVolume, finalizeVolume, voxelIndex } from '../grid_utils'
import type { VoxelMesh, VoxelVolume } from '../types'
import { computeGrid, fillInterior, hollowShell, meshBounds } from './pipeline_utils'
import { triangleBoxOverlap, type Vec3 } from './triangle_box'

export interface CpuVoxelOptions {
  resolution: number
  shellThickness: number
  voxelMm: number
  onProgress?: (ratio: number) => void
}

/**
 * CPU 参考体素化：空间分箱 + 每箱三角 SAT 测试
 * 与 GPU 路径结果一致，作为不支持 WebGPU 时的兜底
 */
export const voxelizeCpu = (mesh: VoxelMesh, options: CpuVoxelOptions): VoxelVolume => {
  const start = performance.now()
  const { resolution, shellThickness, voxelMm } = options
  const { min, max } = meshBounds(mesh.positions)
  const { size, voxelSize, origin } = computeGrid(min, max, resolution)
  const vol = createVolume(size, voxelMm, origin)

  // 三角形按包围盒分箱，后续只对可能命中的体素做测试
  const cellCount = size[0] * size[1] * size[2]
  const bins: number[][] = Array.from({ length: cellCount }, () => [])
  const triCount = mesh.indices.length / 3

  const cellRange = (
    lo: number,
    hi: number,
    axis: 0 | 1 | 2,
  ): [number, number] => {
    const c0 = Math.max(0, Math.floor((lo - origin[axis]) / voxelSize))
    const c1 = Math.min(size[axis] - 1, Math.floor((hi - origin[axis]) / voxelSize))
    return [c0, c1]
  }

  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3]
    const ib = mesh.indices[t * 3 + 1]
    const ic = mesh.indices[t * 3 + 2]
    let loX = Infinity
    let hiX = -Infinity
    let loY = Infinity
    let hiY = -Infinity
    let loZ = Infinity
    let hiZ = -Infinity
    for (const vi of [ia, ib, ic]) {
      const px = mesh.positions[vi * 3]
      const py = mesh.positions[vi * 3 + 1]
      const pz = mesh.positions[vi * 3 + 2]
      loX = Math.min(loX, px)
      hiX = Math.max(hiX, px)
      loY = Math.min(loY, py)
      hiY = Math.max(hiY, py)
      loZ = Math.min(loZ, pz)
      hiZ = Math.max(hiZ, pz)
    }
    const [x0, x1] = cellRange(loX, hiX, 0)
    const [y0, y1] = cellRange(loY, hiY, 1)
    const [z0, z1] = cellRange(loZ, hiZ, 2)
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          bins[voxelIndex(size, x, y, z)].push(t)
        }
      }
    }
  }

  const vert = (vi: number): Vec3 => ({
    x: mesh.positions[vi * 3],
    y: mesh.positions[vi * 3 + 1],
    z: mesh.positions[vi * 3 + 2],
  })

  for (let z = 0; z < size[2]; z++) {
    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        const idx = voxelIndex(size, x, y, z)
        const candidates = bins[idx]
        if (candidates.length === 0) continue
        const center: Vec3 = {
          x: origin[0] + (x + 0.5) * voxelSize,
          y: origin[1] + (y + 0.5) * voxelSize,
          z: origin[2] + (z + 0.5) * voxelSize,
        }
        const half: Vec3 = {
          x: voxelSize * 0.5,
          y: voxelSize * 0.5,
          z: voxelSize * 0.5,
        }

        let r = 0
        let g = 0
        let b = 0
        let hits = 0
        for (const t of candidates) {
          const ia = mesh.indices[t * 3]
          const ib = mesh.indices[t * 3 + 1]
          const ic = mesh.indices[t * 3 + 2]
          if (!triangleBoxOverlap(center, half, vert(ia), vert(ib), vert(ic))) continue
          vol.occupancy[idx] = 1
          r += mesh.colors[ia * 3] + mesh.colors[ib * 3] + mesh.colors[ic * 3]
          g += mesh.colors[ia * 3 + 1] + mesh.colors[ib * 3 + 1] + mesh.colors[ic * 3 + 1]
          b += mesh.colors[ia * 3 + 2] + mesh.colors[ib * 3 + 2] + mesh.colors[ic * 3 + 2]
          hits += 3
        }
        if (hits > 0) {
          vol.sampleRGB[idx * 3] = Math.round(r / hits)
          vol.sampleRGB[idx * 3 + 1] = Math.round(g / hits)
          vol.sampleRGB[idx * 3 + 2] = Math.round(b / hits)
        }
      }
    }
    options.onProgress?.((z + 1) / size[2])
  }

  fillInterior(vol)
  hollowShell(vol, shellThickness)
  finalizeVolume(vol)
  vol.stats.engine = 'cpu'
  vol.stats.elapsedMs = performance.now() - start
  return vol
}

/** 给体素表面补采样色：内部体素沿用最近表面色，防止渲染发黑 */
export const propagateInteriorColors = (vol: VoxelVolume): void => {
  const { size, occupancy, sampleRGB } = vol
  const n = occupancy.length
  const visited = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  for (let idx = 0; idx < n; idx++) {
    if (occupancy[idx] === 1) {
      visited[idx] = 1
      queue[tail++] = idx
    }
  }
  const nx = size[0]
  const layer = size[0] * size[1]
  // 仅对未配色的实心体素做一次邻居均值扩散
  let guard = 0
  while (head < tail && guard < n * 2) {
    guard++
    const idx = queue[head++]
    if (sampleRGB[idx * 3] === 0 && sampleRGB[idx * 3 + 1] === 0 && sampleRGB[idx * 3 + 2] === 0) {
      const nbs = [idx + 1, idx - 1, idx + nx, idx - nx, idx + layer, idx - layer]
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (const nb of nbs) {
        if (nb < 0 || nb >= n || occupancy[nb] !== 1) continue
        if (sampleRGB[nb * 3] || sampleRGB[nb * 3 + 1] || sampleRGB[nb * 3 + 2]) {
          r += sampleRGB[nb * 3]
          g += sampleRGB[nb * 3 + 1]
          b += sampleRGB[nb * 3 + 2]
          count++
        }
      }
      if (count > 0) {
        sampleRGB[idx * 3] = r / count
        sampleRGB[idx * 3 + 1] = g / count
        sampleRGB[idx * 3 + 2] = b / count
      } else {
        queue[tail++] = idx
      }
    }
  }
}
