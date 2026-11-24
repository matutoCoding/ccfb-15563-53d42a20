import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  Color,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { getPaletteColor } from '../palette'
import type { Brick, VoxelVolume } from '../types'

/**
 * 积木三维渲染器
 * - InstancedMesh 实例化，单 draw call 支撑十万级颗粒
 * - PBR MeshStandardMaterial 塑料质感，凸点用独立实例圆柱
 * - 支持体素模式、砖模式、按层裁剪、步骤高亮
 */

const HIGHLIGHT = new Color('#f59e0b')

export class BrickViewer {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera: PerspectiveCamera
  private controls: OrbitControls
  private brickGroup = new Group()
  private studGroup = new Group()
  private raycaster = new Raycaster()
  private pointer = new Vector2()
  private volume: VoxelVolume | null = null
  private frame = 0
  private disposed = false

  /** 体素模式下每个实例对应的格索引，射线拾取用 */
  private voxelInstanceIndex: number[] = []

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new Color('#f1f5f9')

    this.camera = new PerspectiveCamera(42, 1, 0.1, 2000)
    this.camera.position.set(120, 110, 140)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 20, 0)

    const hemi = new HemisphereLight('#ffffff', '#cbd5e1', 0.85)
    const key = new DirectionalLight('#ffffff', 1.6)
    key.position.set(80, 140, 60)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const fill = new AmbientLight('#ffffff', 0.35)
    this.scene.add(hemi, key, fill)
    this.scene.add(this.brickGroup, this.studGroup)

    this.resize()
    this.animate()
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private animate = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  clearMeshes(): void {
    for (const group of [this.brickGroup, this.studGroup]) {
      for (const child of [...group.children]) {
        const mesh = child as InstancedMesh
        mesh.dispose?.()
        group.remove(child)
      }
    }
  }

  /** 体素模式：每实心格一颗颗粒 */
  showVoxels(vol: VoxelVolume, options?: { maxLayer?: number }): void {
    this.clearMeshes()
    this.volume = vol
    this.voxelInstanceIndex = []
    const s = vol.voxelMm
    const items: Array<{ pos: Vector3; color: number }> = []
    const studs: Array<{ pos: Vector3; color: number }> = []
    for (let z = 0; z < vol.size[2]; z++) {
      if (options?.maxLayer !== undefined && z > options.maxLayer) break
      for (let y = 0; y < vol.size[1]; y++) {
        for (let x = 0; x < vol.size[0]; x++) {
          const idx = x + vol.size[0] * (y + vol.size[1] * z)
          if (vol.occupancy[idx] !== 1) continue
          const colorId = vol.colorIndex[idx] === 255 ? 0 : vol.colorIndex[idx]
          const wx = (x - (vol.size[0] - 1) / 2) * s
          const wy = (z - (vol.size[2] - 1) / 2) * s
          const wz = (y - (vol.size[1] - 1) / 2) * s
          items.push({ pos: new Vector3(wx, wy, wz), color: colorId })
          this.voxelInstanceIndex.push(idx)
          // 顶层格才显示凸点，减少实例数
          const above =
            z + 1 >= vol.size[2] ||
            vol.occupancy[idx + vol.size[0] * vol.size[1]] !== 1
          if (above) studs.push({ pos: new Vector3(wx, wy + s * 0.55, wz), color: colorId })
        }
      }
    }
    this.buildInstances(items, studs, s * 0.92)
    this.frameCamera(vol)
  }

  /** 屏幕坐标射线拾取体素格索引，未命中返回 null */
  pickVoxel(clientX: number, clientY: number): number | null {
    const mesh = this.brickGroup.children[0] as InstancedMesh | undefined
    if (!mesh || !this.volume) return null
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(mesh, false)
    if (hits.length === 0 || hits[0].instanceId === undefined) return null
    return this.voxelInstanceIndex[hits[0].instanceId] ?? null
  }

  /** 砖模式：按砖尺寸实例化，highlightIds 中的砖用琥珀色高亮 */
  showBricks(
    vol: VoxelVolume,
    bricks: Brick[],
    options?: { maxLayer?: number; highlightIds?: Set<number>; ghostBelow?: boolean },
  ): void {
    this.clearMeshes()
    const s = vol.voxelMm
    const items: Array<{ pos: Vector3; color: number; scale: Vector3 }> = []
    const studs: Array<{ pos: Vector3; color: number }> = []
    const highlight = options?.highlightIds ?? new Set<number>()

    for (const b of bricks) {
      if (options?.maxLayer !== undefined && b.z > options.maxLayer) continue
      const wx = (b.x - (vol.size[0] - 1) / 2 + (b.w - 1) / 2) * s
      const wy = (b.z - (vol.size[2] - 1) / 2) * s
      const wz = (b.y - (vol.size[1] - 1) / 2 + (b.d - 1) / 2) * s
      const dim = new Vector3(b.w * s * 0.96, s * 0.96, b.d * s * 0.96)
      const color = highlight.has(b.id) ? -1 : b.colorIndex
      items.push({ pos: new Vector3(wx, wy, wz), color, scale: dim })

      // 砖顶面每颗粒一个凸点
      for (let dx = 0; dx < b.w; dx++) {
        for (let dy = 0; dy < b.d; dy++) {
          const sx = (b.x + dx - (vol.size[0] - 1) / 2) * s
          const sz = (b.y + dy - (vol.size[1] - 1) / 2) * s
          studs.push({
            pos: new Vector3(sx, wy + s * 0.55, sz),
            color,
          })
        }
      }
    }
    this.buildInstances(items, studs, s)
    this.frameCamera(vol)
  }

  private buildInstances(
    items: Array<{ pos: Vector3; color: number; scale?: Vector3 }>,
    studs: Array<{ pos: Vector3; color: number }>,
    unit: number,
  ): void {
    if (items.length === 0) return
    const box = new BoxGeometry(1, 1, 1)
    const boxMat = new MeshStandardMaterial({
      roughness: 0.38,
      metalness: 0.04,
      vertexColors: false,
    })
    const boxMesh = new InstancedMesh(box, boxMat, items.length)
    boxMesh.castShadow = true
    boxMesh.receiveShadow = true
    const matrix = new Matrix4()
    const quat = new Quaternion()
    items.forEach((item, i) => {
      const scale = item.scale ?? new Vector3(unit, unit, unit)
      matrix.compose(item.pos, quat, scale)
      boxMesh.setMatrixAt(i, matrix)
      const c = item.color === -1 ? HIGHLIGHT : new Color(getPaletteColor(item.color).hex)
      boxMesh.setColorAt(i, c)
    })
    boxMesh.instanceMatrix.needsUpdate = true
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true
    this.brickGroup.add(boxMesh)

    if (studs.length === 0) return
    const studGeo = new CylinderGeometry(unit * 0.28, unit * 0.28, unit * 0.22, 16)
    const studMat = new MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 })
    const studMesh = new InstancedMesh(studGeo, studMat, studs.length)
    studs.forEach((stud, i) => {
      matrix.compose(stud.pos, quat, new Vector3(1, 1, 1))
      studMesh.setMatrixAt(i, matrix)
      const c = stud.color === -1 ? HIGHLIGHT : new Color(getPaletteColor(stud.color).hex)
      studMesh.setColorAt(i, c)
    })
    studMesh.instanceMatrix.needsUpdate = true
    if (studMesh.instanceColor) studMesh.instanceColor.needsUpdate = true
    this.studGroup.add(studMesh)
  }

  private frameCamera(vol: VoxelVolume): void {
    const s = vol.voxelMm
    const radius = (Math.max(...vol.size) * s) / 2
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(radius * 1.6, radius * 1.4, radius * 1.8)
    this.camera.near = Math.max(0.1, radius / 100)
    this.camera.far = radius * 30
    this.camera.updateProjectionMatrix()
  }

  /** PDF 导出用快照 */
  snapshot(): HTMLCanvasElement {
    this.renderer.render(this.scene, this.camera)
    return this.canvas
  }

  setBackground(hex: string): void {
    this.scene.background = new Color(hex)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.clearMeshes()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
