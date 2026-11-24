import {
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Object3D } from 'three'

import { normalizeMesh } from './obj_parser'
import type { VoxelMesh } from '../types'

/**
 * glTF/GLB 导入：GLTFLoader 解析场景，合并所有网格
 * 贴图颜色通过离屏 canvas 按 uv 烘焙到顶点色，无贴图时取材质基色
 */
export const parseGltf = async (url: string, fileName: string): Promise<VoxelMesh> => {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const meshes: Mesh[] = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((obj: Object3D) => {
    if (obj instanceof Mesh) meshes.push(obj)
  })
  if (meshes.length === 0) throw new Error('glTF 中未找到网格')

  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (const mesh of meshes) {
    const geo = mesh.geometry
    const posAttr = geo.getAttribute('position') as BufferAttribute
    const uvAttr = geo.getAttribute('uv') as BufferAttribute | null
    const normalAttr = geo.getAttribute('normal') as BufferAttribute | null
    const indexAttr = geo.getIndex()
    const material = collectMaterials(mesh)
    const vertexOffset = positions.length / 3
    const v = new Vector3()

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
      const rgb = bakeVertexColor(material, uvAttr, i, normalAttr)
      colors.push(rgb[0], rgb[1], rgb[2])
    }
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i) + vertexOffset)
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(i + vertexOffset)
    }
  }

  return normalizeMesh(
    {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      colors: new Uint8Array(colors),
      triangleCount: indices.length / 3,
      boundsRadius: 1,
      fileName,
    },
    fileName,
  )
}

const collectMaterials = (mesh: Mesh): MeshStandardMaterial[] => {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return list.filter((m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial)
}

const bakeCanvas = document.createElement('canvas')

const bakeVertexColor = (
  materials: MeshStandardMaterial[],
  uvAttr: BufferAttribute | null,
  vertex: number,
  normalAttr: BufferAttribute | null,
): [number, number, number] => {
  const base = new Color(0.75, 0.75, 0.75)
  if (materials.length > 0) base.copy(materials[0].color)
  if (uvAttr && materials[0]?.map) {
    const tex = materials[0].map
    const img = tex.image as CanvasImageSource | undefined
    if (img && 'width' in img && (img.width as number) > 0) {
      const u = uvAttr.getX(vertex)
      const v = uvAttr.getY(vertex)
      const rgb = sampleTexture(img, tex.repeat.x, tex.repeat.y, tex.offset.x, tex.offset.y, u, v)
      if (rgb) return rgb
    }
  }
  // 简单漫反射明暗：法线朝上稍亮，增强体素层次
  let shade = 1
  if (normalAttr) {
    const ny = normalAttr.getY(vertex)
    shade = 0.85 + Math.max(0, ny) * 0.2
  }
  return [
    Math.min(255, base.r * 255 * shade),
    Math.min(255, base.g * 255 * shade),
    Math.min(255, base.b * 255 * shade),
  ]
}

const sampleTexture = (
  img: CanvasImageSource,
  repeatX: number,
  repeatY: number,
  offsetX: number,
  offsetY: number,
  u: number,
  v: number,
): [number, number, number] | null => {
  const width =
    'width' in img && typeof img.width === 'number' ? (img.width as number) : 0
  const height =
    'height' in img && typeof img.height === 'number' ? (img.height as number) : 0
  if (!width || !height) return null
  bakeCanvas.width = width
  bakeCanvas.height = height
  const ctx = bakeCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, width, height)
  const tu = (u * repeatX + offsetX) % 1
  const tv = (v * repeatY + offsetY) % 1
  const px = Math.floor(Math.max(0, Math.min(0.999, tu)) * width)
  const py = Math.floor(Math.max(0, Math.min(0.999, tv)) * height)
  const data = ctx.getImageData(px, py, 1, 1).data
  return [data[0], data[1], data[2]]
}
