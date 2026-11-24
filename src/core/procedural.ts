import { createVolume, finalizeVolume, voxelIndex } from './grid_utils'
import type { VoxelMesh, VoxelVolume } from './types'

/**
 * 程序化样例模型：直接生成已归一化的 VoxelMesh
 * 体素级构造，再转成每格一个立方体的网格，走统一体素化管线
 */

const PALETTE_RGB: Record<string, [number, number, number]> = {
  orange: [232, 133, 31],
  cream: [221, 201, 163],
  pink: [243, 167, 192],
  black: [27, 29, 32],
  red: [208, 39, 45],
  brown: [122, 74, 40],
  gray: [196, 200, 204],
  blue: [31, 78, 140],
  white: [244, 244, 244],
  green: [76, 154, 63],
}

interface VoxelBuilder {
  size: [number, number, number]
  cells: Map<number, [number, number, number]>
}

const makeBuilder = (size: [number, number, number]): VoxelBuilder => ({
  size,
  cells: new Map(),
})

const put = (b: VoxelBuilder, x: number, y: number, z: number, color: string): void => {
  if (x < 0 || y < 0 || z < 0 || x >= b.size[0] || y >= b.size[1] || z >= b.size[2]) return
  b.cells.set(voxelIndex(b.size, x, y, z), PALETTE_RGB[color])
}

const fillBox = (
  b: VoxelBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  color: string,
): void => {
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) put(b, x, y, z, color)
    }
  }
}

/** 坐着的猫：身体+头+耳朵+尾巴+脸，奶油色胸腹 */
const buildCatCells = (): VoxelBuilder => {
  const b = makeBuilder([18, 26, 22])
  // 下半身（坐姿底座）
  fillBox(b, 5, 7, 0, 12, 17, 5, 'orange')
  // 身体
  fillBox(b, 5, 8, 6, 12, 16, 12, 'orange')
  // 胸腹奶油色
  fillBox(b, 6, 8, 6, 11, 11, 12, 'cream')
  // 头
  fillBox(b, 4, 9, 13, 13, 17, 19, 'orange')
  // 脸颊
  fillBox(b, 6, 9, 13, 11, 13, 15, 'cream')
  // 耳朵（三角收尖）
  fillBox(b, 4, 15, 19, 6, 17, 20, 'orange')
  fillBox(b, 11, 15, 19, 13, 17, 20, 'orange')
  put(b, 5, 16, 21, 'orange')
  put(b, 12, 16, 21, 'orange')
  // 耳内粉
  put(b, 5, 16, 20, 'pink')
  put(b, 12, 16, 20, 'pink')
  // 眼睛
  put(b, 6, 16, 17, 'black')
  put(b, 11, 16, 17, 'black')
  // 鼻子
  put(b, 8, 17, 15, 'pink')
  put(b, 9, 17, 15, 'pink')
  // 前爪
  fillBox(b, 6, 8, 0, 7, 10, 5, 'cream')
  fillBox(b, 10, 8, 0, 11, 10, 5, 'cream')
  // 尾巴：沿右侧向上卷
  for (let z = 0; z <= 9; z++) put(b, 13, 12, z, 'orange')
  put(b, 13, 12, 10, 'orange')
  put(b, 12, 12, 10, 'orange')
  put(b, 12, 12, 11, 'orange')
  return b
}

/** 小房子：墙+红屋顶+门+窗+烟囱 */
const buildHouseCells = (): VoxelBuilder => {
  const b = makeBuilder([20, 18, 18])
  // 墙体（中空由后续掏空管线处理，这里给实心墙盒）
  fillBox(b, 2, 2, 0, 17, 15, 10, 'white')
  // 门洞
  fillBox(b, 8, 2, 0, 11, 2, 4, 'brown')
  // 窗
  fillBox(b, 4, 2, 5, 6, 2, 7, 'blue')
  fillBox(b, 13, 2, 5, 15, 2, 7, 'blue')
  // 山墙
  for (let level = 0; level < 4; level++) {
    const inset = level
    fillBox(b, 2 + inset, 2, 11 + level, 17 - inset, 15, 11 + level, 'white')
  }
  // 双坡红屋顶
  for (let level = 0; level < 5; level++) {
    const inset = level
    fillBox(b, 1 + inset, 1, 11 + level, 18 - inset, 16, 11 + level, 'red')
  }
  // 烟囱
  fillBox(b, 14, 10, 12, 15, 12, 15, 'gray')
  put(b, 14, 10, 16, 'black')
  put(b, 15, 10, 16, 'black')
  // 门前小径
  for (let y = 0; y <= 1; y++) {
    for (let x = 8; x <= 11; x++) put(b, x, y, 0, 'gray')
  }
  return b
}

/** Builder -> 每体素一个立方体的 VoxelMesh，边长 1，居中于原点 */
const builderToMesh = (b: VoxelBuilder, fileName: string): VoxelMesh => {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const [sx, sy, sz] = b.size
  const ox = (sx - 1) / 2
  const oy = (sy - 1) / 2

  // 单面立方体的 6 面 36 索引模板
  const faceDefs: Array<{ normal: number[]; corners: number[][] }> = [
    { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ]
  const faceIdx = [0, 1, 2, 0, 2, 3]

  let vBase = 0
  for (const [idx, rgb] of b.cells) {
    const x = idx % sx
    const y = Math.floor(idx / sx) % sy
    const z = Math.floor(idx / (sx * sy))
    const cx = x - ox
    const cy = y - oy
    const cz = z
    for (const face of faceDefs) {
      for (const corner of face.corners) {
        positions.push(cx + corner[0] - 0.5, cy + corner[1] - 0.5, cz + corner[2] - 0.5)
        colors.push(rgb[0], rgb[1], rgb[2])
      }
      for (const fi of faceIdx) indices.push(vBase + fi)
      vBase += 4
    }
  }

  const boundsRadius = Math.max(sx, sy, sz) / 2
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors: new Uint8Array(colors),
    triangleCount: indices.length / 3,
    boundsRadius,
    fileName,
  }
}

export const createSampleCat = (): VoxelMesh => builderToMesh(buildCatCells(), '坐猫_程序化模型.obj')

export const createSampleHouse = (): VoxelMesh =>
  builderToMesh(buildHouseCells(), '小房子_程序化模型.obj')

/** 直接生成体素体积（跳过网格体素化，用于演示页快速预览） */
const builderToVolume = (b: VoxelBuilder, voxelMm: number): VoxelVolume => {
  const vol = createVolume(b.size, voxelMm)
  for (const [idx, rgb] of b.cells) {
    vol.occupancy[idx] = 1
    vol.sampleRGB[idx * 3] = rgb[0]
    vol.sampleRGB[idx * 3 + 1] = rgb[1]
    vol.sampleRGB[idx * 3 + 2] = rgb[2]
  }
  finalizeVolume(vol)
  return vol
}

export const createSampleCatVolume = (voxelMm: number): VoxelVolume =>
  builderToVolume(buildCatCells(), voxelMm)

export const createSampleHouseVolume = (voxelMm: number): VoxelVolume =>
  builderToVolume(buildHouseCells(), voxelMm)
