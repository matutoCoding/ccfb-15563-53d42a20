import { colorDistance, hexToRgb, rgbToLab } from './math_utils'
import { PALETTE } from './palette'
import type { VoxelVolume } from './types'

export interface QuantizeResult {
  /** 色卡 id -> 使用体素数 */
  usage: Map<number, number>
  /** 缺货被替换的原始色 id -> 实际色 id */
  substitutions: Map<number, number>
  lockedCount: number
}

const paletteLab = PALETTE.map((c) => rgbToLab(...hexToRgb(c.hex)))

/** 在库色中的最近色；includeOutOfStock=true 时先做全量匹配（用于报告替换关系） */
const nearestColor = (
  lab: [number, number, number],
  includeOutOfStock: boolean,
): number => {
  let best = PALETTE[0].id
  let bestDist = Infinity
  for (const c of PALETTE) {
    if (!includeOutOfStock && !c.inStock) continue
    const d = colorDistance(lab, paletteLab[c.id])
    if (d < bestDist) {
      bestDist = d
      best = c.id
    }
  }
  return best
}

/**
 * 体素配色：采样 RGB 量化到颗粒色卡
 * - locked 中的体素强制使用锁定色
 * - autoSubstitute 开启时，缺货最近色自动替换为在库最近色
 */
export const quantizeColors = (
  vol: VoxelVolume,
  locked: Map<number, number>,
  autoSubstitute: boolean,
): QuantizeResult => {
  const usage = new Map<number, number>()
  const substitutions = new Map<number, number>()
  let lockedCount = 0

  for (let idx = 0; idx < vol.occupancy.length; idx++) {
    if (vol.occupancy[idx] !== 1) continue
    const lockedColor = locked.get(idx)
    let colorId: number
    if (lockedColor !== undefined) {
      colorId = lockedColor
      lockedCount++
    } else {
      const lab = rgbToLab(
        vol.sampleRGB[idx * 3],
        vol.sampleRGB[idx * 3 + 1],
        vol.sampleRGB[idx * 3 + 2],
      )
      colorId = nearestColor(lab, true)
      const target = PALETTE[colorId]
      if (!target.inStock && autoSubstitute) {
        const replacement = nearestColor(lab, false)
        substitutions.set(colorId, replacement)
        colorId = replacement
      }
    }
    vol.colorIndex[idx] = colorId
    usage.set(colorId, (usage.get(colorId) ?? 0) + 1)
  }
  return { usage, substitutions, lockedCount }
}

/** 单个体素重新取最近在库色（图纸页手动改色用） */
export const pickNearestInStock = (r: number, g: number, b: number): number =>
  nearestColor(rgbToLab(r, g, b), false)
