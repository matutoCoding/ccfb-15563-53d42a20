import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { buildBom } from '../bom'
import { downloadBlob } from '../math_utils'
import type { BrickPlan } from '../types'

/**
 * PDF 分步图纸导出
 * 每一步由调用方渲染成 canvas 快照传入，规避中文字体嵌入问题
 * （文字用英文/数字 + canvas 位图混排）
 */
export interface StepSnapshot {
  stepIndex: number
  layer: number
  canvas: HTMLCanvasElement
  addedBrickCount: number
}

export const exportPlanPdf = async (
  snapshots: StepSnapshot[],
  plan: BrickPlan,
  orderName: string,
): Promise<void> => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageWidth = 595.28 // A4
  const pageHeight = 841.89
  const margin = 40

  // 封面
  const cover = pdf.addPage([pageWidth, pageHeight])
  cover.drawText('Brick Forge - Build Instructions', {
    x: margin,
    y: pageHeight - margin - 24,
    size: 22,
    font,
  })
  cover.drawText(`Order: ${sanitize(orderName)}`, {
    x: margin,
    y: pageHeight - margin - 56,
    size: 14,
    font,
  })
  const bom = buildBom(plan)
  cover.drawText(`Total bricks: ${plan.bricks.length}    Steps: ${snapshots.length}`, {
    x: margin,
    y: pageHeight - margin - 84,
    size: 12,
    font,
  })
  let y = pageHeight - margin - 120
  cover.drawText('Bill of Materials', { x: margin, y, size: 14, font })
  y -= 22
  for (const row of bom.slice(0, 30)) {
    cover.drawText(
      `${row.typeLabel}  color#${row.colorId}  x${row.count}${row.isSupport ? '  (support)' : ''}`,
      { x: margin + 12, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) },
    )
    y -= 16
    if (y < margin + 80) break
  }

  // 每步一页：快照 + 步骤信息
  for (const snap of snapshots) {
    const page = pdf.addPage([pageWidth, pageHeight])
    page.drawText(`Step ${snap.stepIndex + 1} / ${snapshots.length}   Layer ${snap.layer + 1}`, {
      x: margin,
      y: pageHeight - margin,
      size: 14,
      font,
    })
    page.drawText(`New bricks in this step: ${snap.addedBrickCount}`, {
      x: margin,
      y: pageHeight - margin - 20,
      size: 11,
      font,
      color: rgb(0.35, 0.35, 0.35),
    })

    const pngBytes = await canvasToBytes(snap.canvas)
    const png = await pdf.embedPng(pngBytes)
    const maxW = pageWidth - margin * 2
    const maxH = pageHeight - margin * 3 - 60
    const ratio = Math.min(maxW / png.width, maxH / png.height)
    const drawW = png.width * ratio
    const drawH = png.height * ratio
    page.drawImage(png, {
      x: (pageWidth - drawW) / 2,
      y: pageHeight - margin - 40 - drawH,
      width: drawW,
      height: drawH,
    })
  }

  const bytes = await pdf.save()
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${sanitize(orderName)}_图纸.pdf`)
}

const canvasToBytes = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('canvas 导出失败'))
        return
      }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })

const sanitize = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '_')
