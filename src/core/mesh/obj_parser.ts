import type { VoxelMesh } from '../types'

/**
 * OBJ + MTL 解析器
 * 支持 v/vt/vn/f、usemtl、mtllib、Ka/Kd 基础材质色与 map_Kd 贴图引用
 * 贴图通过外部传入的文件名映射解析（浏览器端由 import 页面读取 File）
 */

export interface ObjAssets {
  objText: string
  /** 材质文件名（小写）-> 文本内容 */
  mtlTexts?: Map<string, string>
  /** 贴图文件名（小写）-> HTMLImageElement/Canvas 图片源 */
  images?: Map<string, CanvasImageSource>
}

interface ObjMaterial {
  kd: [number, number, number]
  mapKd?: string
}

export const parseObj = async (assets: ObjAssets, fileName: string): Promise<VoxelMesh> => {
  const lines = assets.objText.split(/\r?\n/)
  const positions: number[] = []
  const uvs: number[] = []
  const materials = new Map<string, ObjMaterial>()
  let current: ObjMaterial = { kd: [0.75, 0.75, 0.75] }
  let pendingMtl = ''

  const outPos: number[] = []
  const outColor: number[] = []
  const outIdx: number[] = []
  let vertexMap = new Map<string, number>()

  const flushMtl = (name: string): void => {
    const mtl = materials.get(name.toLowerCase())
    if (mtl) current = mtl
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [tag, ...rest] = line.split(/\s+/)
    if (tag === 'mtllib') {
      pendingMtl = rest.join(' ').toLowerCase()
      const text = assets.mtlTexts?.get(pendingMtl)
      if (text) parseMtl(text, materials)
    } else if (tag === 'v') {
      positions.push(Number(rest[0]), Number(rest[1]), Number(rest[2]))
    } else if (tag === 'vt') {
      uvs.push(Number(rest[0]), Number(rest[1]))
    } else if (tag === 'usemtl') {
      flushMtl(rest.join(' '))
    } else if (tag === 'f') {
      const cornerIdx: number[] = []
      for (const token of rest) {
        const key = `${token}@${current.mapKd ?? current.kd.join(',')}`
        const cached = vertexMap.get(key)
        if (cached !== undefined) {
          cornerIdx.push(cached)
          continue
        }
        const parts = token.split('/')
        const vi = parseIndex(parts[0], positions.length / 3)
        const base = vi * 3
        const rgb = sampleMaterialColor(current, parts[1], uvs, assets.images)
        const newId = outPos.length / 3
        outPos.push(positions[base], positions[base + 1], positions[base + 2])
        outColor.push(rgb[0], rgb[1], rgb[2])
        vertexMap.set(key, newId)
        cornerIdx.push(newId)
      }
      // 扇形三角化
      for (let i = 1; i < cornerIdx.length - 1; i++) {
        outIdx.push(cornerIdx[0], cornerIdx[i], cornerIdx[i + 1])
      }
      // 顶点缓存控制规模
      if (vertexMap.size > 200000) vertexMap = new Map()
    }
  }

  return normalizeMesh(
    {
      positions: new Float32Array(outPos),
      indices: new Uint32Array(outIdx),
      colors: new Uint8Array(outColor),
      triangleCount: outIdx.length / 3,
      boundsRadius: 1,
      fileName,
    },
    fileName,
  )
}

const parseIndex = (token: string, total: number): number => {
  const v = Number(token)
  return v > 0 ? v - 1 : total + v
}

const parseMtl = (text: string, out: Map<string, ObjMaterial>): void => {
  let name = ''
  let mat: ObjMaterial = { kd: [0.75, 0.75, 0.75] }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [tag, ...rest] = line.split(/\s+/)
    if (tag === 'newmtl') {
      name = rest.join(' ').toLowerCase()
      mat = { kd: [0.75, 0.75, 0.75] }
      out.set(name, mat)
    } else if (tag === 'Kd') {
      mat.kd = [Number(rest[0]), Number(rest[1]), Number(rest[2])]
    } else if (tag === 'map_Kd') {
      mat.mapKd = rest[rest.length - 1].toLowerCase()
    }
  }
}

const sampleMaterialColor = (
  mat: ObjMaterial,
  uvToken: string | undefined,
  uvs: number[],
  images: Map<string, CanvasImageSource> | undefined,
): [number, number, number] => {
  const fallback: [number, number, number] = [
    Math.round(mat.kd[0] * 255),
    Math.round(mat.kd[1] * 255),
    Math.round(mat.kd[2] * 255),
  ]
  if (!mat.mapKd || !uvToken || !images) return fallback
  const img = images.get(mat.mapKd)
  if (!img) return fallback
  const uvIndex = parseIndex(uvToken, uvs.length / 2)
  const u = uvs[uvIndex * 2]
  const v = uvs[uvIndex * 2 + 1]
  return sampleImage(img, u, 1 - v)
}

const sampleCanvas = document.createElement('canvas')

const sampleImage = (
  source: CanvasImageSource,
  u: number,
  v: number,
): [number, number, number] => {
  const width =
    'width' in source && typeof source.width === 'number'
      ? (source.width as number)
      : (source as SVGElement).clientWidth
  const height =
    'height' in source && typeof source.height === 'number'
      ? (source.height as number)
      : (source as SVGElement).clientHeight
  if (!width || !height) return [192, 192, 192]
  sampleCanvas.width = width
  sampleCanvas.height = height
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return [192, 192, 192]
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
  const data = ctx.getImageData(px, py, 1, 1).data
  return [data[0], data[1], data[2]]
}

/** 归一化：最长边缩到 2 个世界单位并居中，控制三角面预算 */
export const normalizeMesh = (mesh: VoxelMesh, fileName: string): VoxelMesh => {
  const p = mesh.positions
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k]
      if (p[i + k] > max[k]) max[k] = p[i + k]
    }
  }
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const longest = Math.max(...span) || 1
  const scale = 2 / longest
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i] - center[0]) * scale
    p[i + 1] = (p[i + 1] - center[1]) * scale
    p[i + 2] = (p[i + 2] - center[2]) * scale
  }
  return { ...mesh, boundsRadius: 1, fileName }
}
