import { findBrickType, getPaletteColor } from './palette'
import type { BrickPlan, PipelineSettings } from './types'

export interface BomRow {
  typeId: string
  typeLabel: string
  colorId: number
  colorName: string
  hex: string
  count: number
  isSupport: boolean
}

/** 按砖型 × 颜色聚合零件清单，支撑件单独标注 */
export const buildBom = (plan: BrickPlan): BomRow[] => {
  const map = new Map<string, BomRow>()
  for (const b of plan.bricks) {
    const key = `${b.typeId}|${b.colorIndex}|${b.isSupport}`
    const existing = map.get(key)
    if (existing) {
      existing.count++
      continue
    }
    const type = findBrickType(b.typeId)
    const color = getPaletteColor(b.colorIndex)
    map.set(key, {
      typeId: b.typeId,
      typeLabel: type.label,
      colorId: b.colorIndex,
      colorName: color.name,
      hex: color.hex,
      count: 1,
      isSupport: b.isSupport,
    })
  }
  return [...map.values()].sort((a, b) => {
    if (a.isSupport !== b.isSupport) return a.isSupport ? 1 : -1
    return a.typeId.localeCompare(b.typeId) || a.colorId - b.colorId
  })
}

export const totalBrickCount = (plan: BrickPlan): number => plan.bricks.length

/** 物理体积估算（毫米³），用于报价参考 */
export const estimateVolumeMm3 = (plan: BrickPlan, settings: PipelineSettings): number => {
  const s = settings.voxelMm
  let cells = 0
  for (const b of plan.bricks) cells += b.w * b.d
  // 砖高约为颗粒边长的 1.2 倍（含凸点底座）
  return cells * s * s * s * 1.2
}

export const bomToCsv = (rows: BomRow[], orderName: string): string => {
  const header = ['砖型', '颜色', '色号', '数量', '是否支撑件']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.typeLabel,
        row.colorName,
        row.colorId,
        row.count,
        row.isSupport ? '是' : '否',
      ].join(','),
    )
  }
  lines.push('')
  lines.push(`订单,${orderName}`)
  lines.push(`总砖数,${rows.reduce((sum, r) => sum + r.count, 0)}`)
  // 加 BOM 头让 Excel 正确识别 UTF-8
  return '﻿' + lines.join('\n')
}

/** 按层统计砖数，图纸页展示 */
export const layerStats = (plan: BrickPlan): Array<{ layer: number; count: number }> => {
  const map = new Map<number, number>()
  for (const b of plan.bricks) map.set(b.z, (map.get(b.z) ?? 0) + 1)
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([layer, count]) => ({ layer, count }))
}
