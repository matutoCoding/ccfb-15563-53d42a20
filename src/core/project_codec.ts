import type { BrickPlan, Order, ProjectData, VoxelVolume } from './types'

/**
 * 工程序列化：TypedArray 转 base64 内嵌 JSON
 * 订单走 localStorage，完整工程支持文件导出/导入
 */

interface SerializedVolume extends Omit<VoxelVolume, 'occupancy' | 'colorIndex' | 'sampleRGB'> {
  occupancy: string
  colorIndex: string
  sampleRGB: string
}

interface SerializedPlan extends Omit<BrickPlan, 'layerOwner' | 'volume'> {
  layerOwner: Record<string, string>
  volume: SerializedVolume
}

export interface SerializedProject extends Omit<ProjectData, 'volume' | 'brickPlan'> {
  volume: SerializedVolume | null
  brickPlan: SerializedPlan | null
}

export interface OrderFile {
  type: 'brick-forge-order'
  version: 1
  exportedAt: number
  order: Omit<Order, 'project'> & { project: SerializedProject | null }
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const serializeVolume = (vol: VoxelVolume): SerializedVolume => ({
  ...vol,
  occupancy: bytesToBase64(vol.occupancy),
  colorIndex: bytesToBase64(vol.colorIndex),
  sampleRGB: bytesToBase64(vol.sampleRGB),
})

const deserializeVolume = (data: SerializedVolume): VoxelVolume => ({
  ...data,
  occupancy: base64ToBytes(data.occupancy),
  colorIndex: base64ToBytes(data.colorIndex),
  sampleRGB: base64ToBytes(data.sampleRGB),
})

const serializePlan = (plan: BrickPlan): SerializedPlan => {
  const layerOwner: Record<string, string> = {}
  for (const [z, owner] of Object.entries(plan.layerOwner)) {
    layerOwner[z] = bytesToBase64(new Uint8Array(owner.buffer.slice(owner.byteOffset, owner.byteOffset + owner.byteLength)))
  }
  const { layerOwner: _omit, volume: _vol, ...rest } = plan
  return { ...rest, layerOwner, volume: serializeVolume(plan.volume) }
}

const deserializePlan = (data: SerializedPlan): BrickPlan => {
  const layerOwner: Record<number, Uint32Array> = {}
  for (const [z, base64] of Object.entries(data.layerOwner)) {
    layerOwner[Number(z)] = new Uint32Array(base64ToBytes(base64).buffer)
  }
  return { ...data, layerOwner, volume: deserializeVolume(data.volume) }
}

export const serializeProject = (project: ProjectData): SerializedProject => ({
  ...project,
  volume: project.volume ? serializeVolume(project.volume) : null,
  brickPlan: project.brickPlan ? serializePlan(project.brickPlan) : null,
})

export const deserializeProject = (data: SerializedProject): ProjectData => ({
  ...data,
  volume: data.volume ? deserializeVolume(data.volume) : null,
  brickPlan: data.brickPlan ? deserializePlan(data.brickPlan) : null,
})

export const serializeOrder = (order: Order): OrderFile => ({
  type: 'brick-forge-order',
  version: 1,
  exportedAt: Date.now(),
  order: { ...order, project: order.project ? serializeProject(order.project) : null },
})

export const deserializeOrderFile = (json: unknown): Order => {
  const file = json as OrderFile
  if (file?.type !== 'brick-forge-order' || file.version !== 1) {
    throw new Error('不是有效的砖造工坊工程文件')
  }
  const { project, ...rest } = file.order
  return {
    ...rest,
    project: project ? deserializeProject(project) : null,
  }
}
