import { defineStore } from 'pinia'

import { DEFAULT_BRICK_TYPE_IDS } from '../core/palette'
import type {
  Order,
  OrderStatus,
  PipelineSettings,
  ProjectData,
  VoxelMesh,
} from '../core/types'
import { uid } from '../core/math_utils'
import {
  deserializeProject,
  serializeProject,
  type SerializedProject,
} from '../core/project_codec'

const STORAGE_KEY = 'brick-forge:orders:v1'
const CURRENT_KEY = 'brick-forge:current-id:v1'

/** 持久化结构：工程中的 TypedArray 必须转 base64，否则 JSON 往返会退化成普通对象 */
type StoredOrder = Omit<Order, 'project'> & { project: SerializedProject | null }

export const defaultSettings = (): PipelineSettings => ({
  resolution: 96,
  shellThickness: 2,
  voxelMm: 8,
  autoSupport: true,
  autoSubstitute: true,
  enabledBrickTypes: [...DEFAULT_BRICK_TYPE_IDS],
})

const emptyProject = (): ProjectData => ({
  version: 1,
  mesh: null,
  volume: null,
  brickPlan: null,
  settings: defaultSettings(),
  updatedAt: Date.now(),
})

interface OrderState {
  orders: Order[]
  currentId: string | null
}

const safeParse = (raw: string | null): Order[] => {
  if (!raw) return []
  try {
    const stored = JSON.parse(raw) as StoredOrder[]
    return stored.map((order) => ({
      ...order,
      project: order.project ? deserializeProject(order.project) : null,
    }))
  } catch {
    return []
  }
}

/** 运行时态：网格对象无法结构化克隆进 localStorage，模块级持有，刷新后重新导入 */
let liveMesh: VoxelMesh | null = null

export const getLiveMesh = (): VoxelMesh | null => liveMesh
export const setLiveMesh = (mesh: VoxelMesh | null): void => {
  liveMesh = mesh
}

export const useOrderStore = defineStore('order', {
  state: (): OrderState => ({
    orders: safeParse(localStorage.getItem(STORAGE_KEY)),
    currentId: localStorage.getItem(CURRENT_KEY),
  }),

  getters: {
    current(state): Order | null {
      return state.orders.find((o) => o.id === state.currentId) ?? null
    },
  },

  actions: {
    persist(): void {
      try {
        const stored: StoredOrder[] = this.orders.map((order) => ({
          ...order,
          project: order.project ? serializeProject(order.project) : null,
        }))
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
        if (this.currentId) localStorage.setItem(CURRENT_KEY, this.currentId)
      } catch (err) {
        console.error('订单持久化失败（可能超出 localStorage 配额）', err)
        throw new Error('工程体积过大，浏览器本地存储失败，请先导出工程文件备份')
      }
    },

    createOrder(input: { customer: string; name: string; note?: string }): Order {
      const now = Date.now()
      const order: Order = {
        id: uid(),
        customer: input.customer,
        name: input.name,
        note: input.note ?? '',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        project: emptyProject(),
      }
      this.orders.unshift(order)
      this.currentId = order.id
      this.persist()
      return order
    },

    updateOrder(id: string, patch: Partial<Pick<Order, 'customer' | 'name' | 'note' | 'status'>>): void {
      const order = this.orders.find((o) => o.id === id)
      if (!order) throw new Error('订单不存在')
      Object.assign(order, patch, { updatedAt: Date.now() })
      this.persist()
    },

    removeOrder(id: string): void {
      this.orders = this.orders.filter((o) => o.id !== id)
      if (this.currentId === id) this.currentId = this.orders[0]?.id ?? null
      this.persist()
    },

    selectOrder(id: string): void {
      if (!this.orders.some((o) => o.id === id)) throw new Error('订单不存在')
      this.currentId = id
      this.persist()
    },

    setStatus(id: string, status: OrderStatus): void {
      const order = this.orders.find((o) => o.id === id)
      if (!order) return
      order.status = status
      order.updatedAt = Date.now()
      this.persist()
    },

    attachMesh(mesh: VoxelMesh): void {
      const order = this.current
      if (!order) throw new Error('请先选择订单')
      if (!order.project) order.project = emptyProject()
      order.project.mesh = {
        fileName: mesh.fileName,
        triangleCount: mesh.triangleCount,
        boundsRadius: mesh.boundsRadius,
      }
      // 网格体本身不进 localStorage，挂在运行时态上
      setLiveMesh(mesh)
      order.project.brickPlan = null
      order.status = 'modeling'
      order.updatedAt = Date.now()
      this.persist()
    },

    importExternal(order: Order): void {
      const idx = this.orders.findIndex((o) => o.id === order.id)
      if (idx >= 0) this.orders.splice(idx, 1)
      this.orders.unshift(order)
      this.currentId = order.id
      this.persist()
    },
  },
})
