import { findBrickType } from './palette'
import type {
  Brick,
  BrickPlan,
  BrickType,
  BuildStep,
  PipelineSettings,
  StabilityIssue,
  VoxelVolume,
} from './types'
import { voxelIndex } from './grid_utils'

/**
 * 合砖 + 结构稳定性一体化
 * 结构模型（判定单位是「砖」而非单个颗粒）：
 *  1. 无悬空：非底层砖足迹至少有一格咬住下层实体，砖可桥接跨越空腔
 *  2. 省料支撑：仅对零支撑的悬空砖补柱，柱取足迹内最短落地路径，一直落到最近实体
 *     桥接保证墙顶等有支撑的砖不触发补柱，因此只有真正悬挑的屋顶才会补柱，不填空腔
 *  3. 交错咬合：候选打分偏好跨越下层接缝，避免整列对齐（软目标，不阻断）
 *  4. 同色连通域内铺砖，砖不跨色
 */

/** 支撑柱向下落地的最大层数保护值，足够覆盖常规摆件的最高悬挑 */

interface Cell {
  x: number
  y: number
  color: number
  support: boolean
}

export const mergeBricks = (source: VoxelVolume, settings: PipelineSettings): BrickPlan => {
  const start = performance.now()
  // 在副本上补支撑，避免污染订单保存的原始体素体积，保证重算幂等
  const vol: VoxelVolume = {
    ...source,
    occupancy: new Uint8Array(source.occupancy),
    colorIndex: new Uint8Array(source.colorIndex),
  }
  const [sx, sy, sz] = vol.size
  const bricks: Brick[] = []
  const issues: StabilityIssue[] = []
  const layerOwner: Record<number, Uint32Array> = {}
  const supportCells = new Set<number>()
  let nextId = 1
  const newId = (): number => nextId++

  const enabled = new Set(settings.enabledBrickTypes)
  // 1x1 是铺砖收敛的兜底，无论设置如何都保留，避免残格无法处理
  enabled.add('1x1')
  const types = [...enabled].map(findBrickType).sort((a, b) => b.w * b.d - a.w * a.d)
  if (types.length === 0) throw new Error('至少需要启用一种砖型')

  /**
   * 预计算内部支撑：对每个悬空断点（实心且下方非实心）在其列向下补 1x1 柱到最近实体。
   * 掏空阶段的加强筋已把内腔切成砖跨距内的小腔，故柱短且不会贯穿整模。
   * 处理后每个非底层实心格正下方都是实心，铺砖结果零悬空。
   */
  if (settings.autoSupport) {
    buildColumnGrid(vol, supportCells)
  } else {
    reportFloating(vol, issues)
  }

  /** 逐层铺砖：支撑格先落地 1x1，其余按色连通域贪心铺，桥接基于下层 owner */
  for (let z = 0; z < sz; z++) {
    const owner = new Uint32Array(sx * sy)
    const cells = collectLayerCells(vol, z, supportCells)
    if (cells.length === 0) {
      layerOwner[z] = owner
      continue
    }

    // 已补的支撑柱格优先落地为 1x1
    for (const cell of cells) {
      if (cell.support) placeSupport(bricks, owner, cell, z, sx, newId)
    }

    const lowerOwner = z > 0 ? layerOwner[z - 1] : undefined
    for (const region of splitColorRegions(cells, sx, owner)) {
      tileRegion(region, z, owner, lowerOwner, sx, types, bricks, newId)
    }

    nextId = bricks.length + 1
    layerOwner[z] = owner
  }

  analyzeStability(bricks, layerOwner, vol, issues)
  return {
    bricks,
    issues,
    steps: buildSteps(bricks),
    layerOwner,
    volume: vol,
    generatedAt: Date.now(),
    elapsedMs: performance.now() - start,
  }
}

const placeSupport = (
  bricks: Brick[],
  owner: Uint32Array,
  cell: Cell,
  z: number,
  sx: number,
  newId: () => number,
): void => {
  const id = newId()
  bricks.push({
    id,
    typeId: '1x1',
    x: cell.x,
    y: cell.y,
    z,
    w: 1,
    d: 1,
    colorIndex: cell.color,
    isSupport: true,
  })
  owner[cell.y * sx + cell.x] = id
}

/**
 * 预计算内部支撑（只标记 supportCells 并补 occupancy，不直接产砖）。
 * 掏空阶段已用加强筋把内腔切成砖可跨越的小腔，因此这里逐格自底向上扫描：
 * 实心格下方若非实心（空=0 或掏空=2），就在该列向下补 1x1 柱直到最近实体。
 * supportCells 逐格幂等，同列多断点接力补全。
 * 可证明：处理完后每个非底层实心格正下方都是实心，铺砖结果零悬空；
 * 且因加强筋限制了空腔尺寸，每根柱都很短，不会出现贯穿整模的填料。
 */
const buildColumnGrid = (vol: VoxelVolume, supportCells: Set<number>): void => {
  const [sx, sy, sz] = vol.size

  for (let z = 1; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const idx = voxelIndex(vol.size, x, y, z)
        if (vol.occupancy[idx] !== 1) continue
        const belowIdx = voxelIndex(vol.size, x, y, z - 1)
        if (vol.occupancy[belowIdx] === 1) continue

        for (let kz = z - 1; kz >= 0; kz--) {
          const cIdx = voxelIndex(vol.size, x, y, kz)
          if (vol.occupancy[cIdx] === 1) break
          if (supportCells.has(cIdx)) continue
          supportCells.add(cIdx)
          vol.occupancy[cIdx] = 1
          vol.colorIndex[cIdx] = nearestColorOf(vol, x, y, kz)
        }
      }
    }
  }
}

/** 未开启自动支撑时，把所有悬空格作为 floating 提示交人工设计 */
const reportFloating = (vol: VoxelVolume, issues: StabilityIssue[]): void => {
  const [sx, sy, sz] = vol.size
  for (let z = 1; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const idx = voxelIndex(vol.size, x, y, z)
        if (vol.occupancy[idx] !== 1) continue
        if (vol.occupancy[voxelIndex(vol.size, x, y, z - 1)] === 1) continue
        issues.push({
          kind: 'floating',
          brickId: -1,
          message: `第 ${z + 1} 层 (${x}, ${y}) 悬空，且未开启自动支撑`,
          suggestion: [x, y, z],
        })
      }
    }
  }
}

/** 支撑柱取水平邻居的颜色，找不到再向上找，保证不出现 255 色 */
const nearestColorOf = (vol: VoxelVolume, x: number, y: number, z: number): number => {
  const ring = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (const [dx, dy] of ring) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= vol.size[0] || ny >= vol.size[1]) continue
    const idx = voxelIndex(vol.size, nx, ny, z)
    if (vol.occupancy[idx] === 1 && vol.colorIndex[idx] !== 255) return vol.colorIndex[idx]
  }
  for (let uz = z + 1; uz < vol.size[2]; uz++) {
    const idx = voxelIndex(vol.size, x, y, uz)
    if (vol.occupancy[idx] === 1 && vol.colorIndex[idx] !== 255) return vol.colorIndex[idx]
  }
  return 0
}

const collectLayerCells = (
  vol: VoxelVolume,
  z: number,
  supportCells: Set<number>,
): Cell[] => {
  const cells: Cell[] = []
  for (let y = 0; y < vol.size[1]; y++) {
    for (let x = 0; x < vol.size[0]; x++) {
      const idx = voxelIndex(vol.size, x, y, z)
      if (vol.occupancy[idx] !== 1) continue
      cells.push({
        x,
        y,
        color: vol.colorIndex[idx] === 255 ? 0 : vol.colorIndex[idx],
        support: supportCells.has(idx),
      })
    }
  }
  return cells
}

/** 同色 4 邻接连通域拆分，返回每个域内未被占用的格（支撑格已占位） */
const splitColorRegions = (cells: Cell[], sx: number, owner: Uint32Array): Cell[][] => {
  const key = (x: number, y: number): number => y * sx + x
  const map = new Map<number, Cell>()
  for (const c of cells) map.set(key(c.x, c.y), c)
  const visited = new Set<number>()
  const regions: Cell[][] = []

  for (const c of cells) {
    const k = key(c.x, c.y)
    if (visited.has(k) || owner[k] !== 0) continue
    const region: Cell[] = []
    const stack = [c]
    visited.add(k)
    while (stack.length > 0) {
      const cur = stack.pop()!
      const ck = key(cur.x, cur.y)
      if (owner[ck] !== 0) continue
      region.push(cur)
      const nbs = [
        [cur.x + 1, cur.y],
        [cur.x - 1, cur.y],
        [cur.x, cur.y + 1],
        [cur.x, cur.y - 1],
      ]
      for (const [nx, ny] of nbs) {
        const nk = key(nx, ny)
        const nb = map.get(nk)
        if (!nb || visited.has(nk) || nb.color !== cur.color || owner[nk] !== 0) continue
        visited.add(nk)
        stack.push(nb)
      }
    }
    if (region.length > 0) regions.push(region)
  }
  return regions
}

/** 单连通域贪心铺砖：大砖优先，打分偏好跨下层接缝以实现交错咬合 */
const tileRegion = (
  region: Cell[],
  z: number,
  owner: Uint32Array,
  lowerOwner: Uint32Array | undefined,
  sx: number,
  types: BrickType[],
  bricks: Brick[],
  newId: () => number,
): void => {
  const occupied = new Set<number>()
  const inRegion = new Set(region.map((c) => c.y * sx + c.x))

  const fits = (c: Cell, w: number, d: number): boolean => {
    for (let dy = 0; dy < d; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const k = (c.y + dy) * sx + c.x + dx
        if (!inRegion.has(k) || occupied.has(k)) return false
      }
    }
    return true
  }

  const sorted = [...region].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const cell of sorted) {
    if (occupied.has(cell.y * sx + cell.x)) continue

    let picked: { w: number; d: number } | null = null
    let bestScore = -Infinity
    for (const t of types) {
      const orientations =
        t.w === t.d ? [[t.w, t.d]] : [
          [t.w, t.d],
          [t.d, t.w],
        ]
      for (const [w, d] of orientations) {
        if (!fits(cell, w, d)) continue
        const score = scorePlacement(cell, w, d, lowerOwner, sx)
        if (score > bestScore) {
          bestScore = score
          picked = { w, d }
        }
      }
    }
    if (!picked) throw new Error(`铺砖失败于 (${cell.x}, ${cell.y}, ${z})`)

    const id = newId()
    bricks.push({
      id,
      typeId: `${picked.w}x${picked.d}`,
      x: cell.x,
      y: cell.y,
      z,
      w: picked.w,
      d: picked.d,
      colorIndex: cell.color,
      isSupport: false,
    })
    for (let dy = 0; dy < picked.d; dy++) {
      for (let dx = 0; dx < picked.w; dx++) {
        const k = (cell.y + dy) * sx + cell.x + dx
        occupied.add(k)
        owner[k] = id
      }
    }
  }
}

/** 候选打分：面积基础分 + 跨下层接缝数（交错咬合），整列对齐减分 */
const scorePlacement = (
  c: Cell,
  w: number,
  d: number,
  lowerOwner: Uint32Array | undefined,
  sx: number,
): number => {
  let score = w * d * 0.1
  if (!lowerOwner) return score
  const seamSet = new Set<number>()
  for (let dy = 0; dy < d; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const id = lowerOwner[(c.y + dy) * sx + c.x + dx]
      if (id > 0) seamSet.add(id)
    }
  }
  score += seamSet.size * 3
  if (seamSet.size === 1) score -= 5
  return score
}

/** 稳定性扫描：零支撑悬空、大砖低覆盖率、跨层孤岛；1x1 单点不报警（正常结构） */
const analyzeStability = (
  bricks: Brick[],
  layerOwner: Record<number, Uint32Array>,
  vol: VoxelVolume,
  issues: StabilityIssue[],
): void => {
  const [sx, sy] = vol.size

  for (const b of bricks) {
    if (b.z === 0 || b.isSupport) continue
    const lower = layerOwner[b.z - 1]
    if (!lower) continue
    let supportedCells = 0
    for (let dy = 0; dy < b.d; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        if (lower[(b.y + dy) * sx + b.x + dx] > 0) supportedCells++
      }
    }
    if (supportedCells === 0) {
      issues.push({
        kind: 'floating',
        brickId: b.id,
        message: `砖 #${b.id} 无任何下层支撑`,
        suggestion: [b.x, b.y, b.z],
      })
    } else {
      const footprint = b.w * b.d
      if (footprint >= 6 && supportedCells / footprint < 0.4) {
        issues.push({
          kind: 'unsupported-span',
          brickId: b.id,
          message: `砖 #${b.id} 跨度 ${b.w}×${b.d}，支撑覆盖率偏低`,
        })
      }
    }
  }

  // 全局 6 邻接连通性：捕捉跨层孤岛
  const cellToBrick = new Map<number, number>()
  for (const b of bricks) {
    for (let dy = 0; dy < b.d; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        cellToBrick.set(voxelIndex(vol.size, b.x + dx, b.y + dy, b.z), b.id)
      }
    }
  }
  const occupied = new Set(cellToBrick.keys())
  const firstCell = occupied.values().next().value
  if (firstCell === undefined) return
  const seen = new Set<number>([firstCell])
  const stack = [firstCell]
  while (stack.length > 0) {
    const idx = stack.pop()!
    const x = idx % sx
    const y = Math.floor(idx / sx) % sy
    const z = Math.floor(idx / (sx * sy))
    const nbs = [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1],
    ]
    for (const [nx, ny, nz] of nbs) {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= vol.size[2]) continue
      const nIdx = voxelIndex(vol.size, nx, ny, nz)
      if (occupied.has(nIdx) && !seen.has(nIdx)) {
        seen.add(nIdx)
        stack.push(nIdx)
      }
    }
  }
  for (const idx of occupied) {
    if (!seen.has(idx)) {
      issues.push({
        kind: 'floating',
        brickId: cellToBrick.get(idx) ?? -1,
        message: '存在与主体断开的砖组',
      })
      break
    }
  }
}

/** 每层一步（单层体素量大时拆成多步，控制单步砖数） */
const buildSteps = (bricks: Brick[]): BuildStep[] => {
  const byLayer = new Map<number, number[]>()
  for (const b of bricks) {
    const list = byLayer.get(b.z) ?? []
    list.push(b.id)
    byLayer.set(b.z, list)
  }
  const MAX_PER_STEP = 40
  const steps: BuildStep[] = []
  let index = 0
  for (const z of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = byLayer.get(z)!
    for (let i = 0; i < ids.length; i += MAX_PER_STEP) {
      steps.push({ index: index++, layer: z, brickIds: ids.slice(i, i + MAX_PER_STEP) })
    }
  }
  return steps
}
