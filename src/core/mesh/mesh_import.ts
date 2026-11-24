import { parseObj } from './obj_parser'
import { parseGltf } from './gltf_parser'
import type { VoxelMesh } from '../types'

/** 根据扩展名分派解析器，obj/gltf/glb，附带同名目录下的贴图与 mtl */
export const importMeshFile = async (file: File, siblings: File[]): Promise<VoxelMesh> => {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.obj')) return importObj(file, siblings)
  if (lower.endsWith('.gltf') || lower.endsWith('.glb')) {
    const url = URL.createObjectURL(file)
    try {
      return await parseGltf(url, file.name)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  throw new Error(`暂不支持的格式: ${file.name}，请使用 OBJ 或 glTF/GLB`)
}

const importObj = async (file: File, siblings: File[]): Promise<VoxelMesh> => {
  const objText = await file.text()
  const mtlTexts = new Map<string, string>()
  const images = new Map<string, CanvasImageSource>()

  const mtlFiles = siblings.filter((f) => f.name.toLowerCase().endsWith('.mtl'))
  for (const f of mtlFiles) mtlTexts.set(f.name.toLowerCase(), await f.text())

  const imageFiles = siblings.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
  await Promise.all(
    imageFiles.map(async (f) => {
      const url = URL.createObjectURL(f)
      try {
        images.set(f.name.toLowerCase(), await loadImage(url))
      } finally {
        URL.revokeObjectURL(url)
      }
    }),
  )
  return parseObj({ objText, mtlTexts, images }, file.name)
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`贴图加载失败: ${url}`))
    img.src = url
  })
