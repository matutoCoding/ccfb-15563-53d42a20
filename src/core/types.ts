/**
 * 全局核心数据模型
 * 体素坐标约定：x 向右、y 纵深、z 向上，单位为「颗粒格」
 */

export type OrderStatus = 'pending' | 'modeling' | 'voxel' | 'colored' | 'planned' | 'done'

export interface Order {
  id: string
  customer: string
  name: string
  note: string
  status: OrderStatus
  createdAt: number
  updatedAt: number
  /** 完整工程数据，体素/砖以 base64 二进制内嵌 */
  project: ProjectData | null
}

export interface ProjectData {
  version: 1
  /** 原始网格信息 */
  mesh: {
    fileName: string
    triangleCount: number
    /** 归一化后的网格包围球半径（世界单位） */
    boundsRadius: number
  } | null
  volume: VoxelVolume | null
  brickPlan: BrickPlan | null
  settings: PipelineSettings
  updatedAt: number
}

/** 体素体积：占用与颜色走定长 Uint8Array，索引 idx(x,y,z) */
export interface VoxelVolume {
  size: [number, number, number]
  /** 0=空 1=实心 2=内部掏空 */
  occupancy: Uint8Array
  /** 每个实心体素的颗粒色卡索引，255 表示未配色 */
  colorIndex: Uint8Array
  /** 体素中心对应的 RGB 采样值（来自贴图或顶点色），用于量化 */
  sampleRGB: Uint8Array
  /** 单颗粒物理尺寸（毫米），建模用 */
  voxelMm: number
  /** 包围盒中心在世界坐标的位置，用于渲染对齐 */
  origin: [number, number, number]
  stats: VoxelStats
}

export interface VoxelStats {
  total: number
  surface: number
  hollowed: number
  maxResolution: number
  shellThickness: number
  engine: 'webgpu' | 'cpu'
  elapsedMs: number
}

/** 砖型：足印 w×d，高度恒为一颗粒层 */
export interface BrickType {
  id: string
  label: string
  w: number
  d: number
}

export interface Brick {
  id: number
  typeId: string
  /** 最小角格坐标 */
  x: number
  y: number
  z: number
  w: number
  d: number
  colorIndex: number
  /** 自动支撑生成的砖 */
  isSupport: boolean
}

export type IssueKind = 'floating' | 'weak' | 'unsupported-span'

export interface StabilityIssue {
  kind: IssueKind
  brickId: number
  message: string
  /** 建议支撑落点（格坐标） */
  suggestion?: [number, number, number]
}

export interface BuildStep {
  index: number
  layer: number
  brickIds: number[]
}

export interface BrickPlan {
  bricks: Brick[]
  issues: StabilityIssue[]
  steps: BuildStep[]
  /** 层 z -> 该层所有体素格的砖归属 id，快速咬合分析用 */
  layerOwner: Record<number, Uint32Array>
  /** 含自动支撑柱的工作副本体积，渲染砖模型时使用 */
  volume: VoxelVolume
  generatedAt: number
  elapsedMs: number
}

export interface PipelineSettings {
  /** 最长边体素分辨率 */
  resolution: number
  /** 壳厚（颗粒格） */
  shellThickness: number
  /** 单颗粒毫米尺寸 */
  voxelMm: number
  /** 自动加支撑 */
  autoSupport: boolean
  /** 缺货色自动替换为最近色 */
  autoSubstitute: boolean
  /** 允许使用的砖型 id */
  enabledBrickTypes: string[]
}

export interface PipelineTiming {
  stage: string
  elapsedMs: number
}

/** 导入后的中间网格：已归一化、三角带材质色 */
export interface VoxelMesh {
  positions: Float32Array
  indices: Uint32Array
  /** 每顶点 rgb 0~255（贴图已烘焙或顶点色） */
  colors: Uint8Array
  triangleCount: number
  boundsRadius: number
  fileName: string
}

export interface PaletteColor {
  id: number
  name: string
  hex: string
  inStock: boolean
}

export interface ColorLock {
  /** 体素索引 */
  voxelIdx: number
  colorIndex: number
}
