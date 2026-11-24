import type { BrickType, PaletteColor } from './types'

/**
 * 颗粒色卡：参照主流积木常用色，inStock=false 模拟缺货
 * 缺货色由配色模块自动替换为最近的在库色
 */
export const PALETTE: PaletteColor[] = [
  { id: 0, name: '白色', hex: '#f4f4f4', inStock: true },
  { id: 1, name: '象牙白', hex: '#e8dec8', inStock: true },
  { id: 2, name: '浅灰', hex: '#c4c8cc', inStock: true },
  { id: 3, name: '深灰', hex: '#6b6f73', inStock: true },
  { id: 4, name: '黑色', hex: '#1b1d20', inStock: true },
  { id: 5, name: '深红', hex: '#9b2a25', inStock: true },
  { id: 6, name: '正红', hex: '#d0272d', inStock: true },
  { id: 7, name: '珊瑚橙', hex: '#f2703c', inStock: true },
  { id: 8, name: '明黄', hex: '#f7c948', inStock: true },
  { id: 9, name: '橄榄绿', hex: '#7a8233', inStock: false },
  { id: 10, name: '草绿', hex: '#4c9a3f', inStock: true },
  { id: 11, name: '深绿', hex: '#1e5631', inStock: true },
  { id: 12, name: '薄荷青', hex: '#7fd1c1', inStock: true },
  { id: 13, name: '天蓝', hex: '#57a5e0', inStock: true },
  { id: 14, name: '深蓝', hex: '#1f4e8c', inStock: true },
  { id: 15, name: '藏青', hex: '#202b54', inStock: true },
  { id: 16, name: '紫色', hex: '#6d3f8f', inStock: true },
  { id: 17, name: '粉色', hex: '#f3a7c0', inStock: true },
  { id: 18, name: '品红', hex: '#c93c7d', inStock: false },
  { id: 19, name: '棕色', hex: '#7a4a28', inStock: true },
  { id: 20, name: '驼色', hex: '#b08968', inStock: true },
  { id: 21, name: '米色', hex: '#ddc9a3', inStock: true },
  { id: 22, name: '橙色', hex: '#e8851f', inStock: true },
  { id: 23, name: '银灰', hex: '#a8b0b8', inStock: true },
]

/** 实际可采购的砖型：1x1 到 2x4，含单格厚板 */
export const BRICK_TYPES: BrickType[] = [
  { id: '1x1', label: '1×1', w: 1, d: 1 },
  { id: '1x2', label: '1×2', w: 2, d: 1 },
  { id: '1x3', label: '1×3', w: 3, d: 1 },
  { id: '1x4', label: '1×4', w: 4, d: 1 },
  { id: '2x2', label: '2×2', w: 2, d: 2 },
  { id: '2x3', label: '2×3', w: 3, d: 2 },
  { id: '2x4', label: '2×4', w: 4, d: 2 },
]

export const DEFAULT_BRICK_TYPE_IDS = BRICK_TYPES.map((t) => t.id)

export const findBrickType = (id: string): BrickType => {
  const t = BRICK_TYPES.find((item) => item.id === id)
  if (!t) throw new Error(`未知砖型: ${id}`)
  return t
}

export const getPaletteColor = (id: number): PaletteColor => {
  const c = PALETTE.find((item) => item.id === id)
  if (!c) throw new Error(`未知色卡 id: ${id}`)
  return c
}
