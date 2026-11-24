import { bomToCsv, buildBom } from '../bom'
import { downloadBlob } from '../math_utils'
import type { BrickPlan } from '../types'

export const exportBomCsv = (plan: BrickPlan, orderName: string): void => {
  const rows = buildBom(plan)
  const csv = bomToCsv(rows, orderName)
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `${orderName.replace(/[\\/:*?"<>|]/g, '_')}_零件清单.csv`,
  )
}

/** 成品效果图：由 3D 视图组件提供 canvas，直接导出 PNG */
export const exportRenderPng = (canvas: HTMLCanvasElement, orderName: string): void => {
  canvas.toBlob((blob) => {
    if (!blob) throw new Error('效果图导出失败')
    downloadBlob(blob, `${orderName.replace(/[\\/:*?"<>|]/g, '_')}_效果图.png`)
  }, 'image/png')
}
