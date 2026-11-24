import { defineStore } from 'pinia'

import { quantizeColors, type QuantizeResult } from '../core/color_quantize'
import { mergeBricks } from '../core/brick_merger'
import { runVoxelize } from '../core/voxel'
import type { PipelineTiming, VoxelMesh, VoxelVolume } from '../core/types'
import { useOrderStore } from './order_store'

interface PipelineState {
  busy: boolean
  progressLabel: string
  progressRatio: number
  engine: 'webgpu' | 'cpu' | null
  fellBack: boolean
  timings: PipelineTiming[]
  colorLocks: Map<number, number>
  lastQuantize: QuantizeResult | null
}

export const usePipelineStore = defineStore('pipeline', {
  state: (): PipelineState => ({
    busy: false,
    progressLabel: '',
    progressRatio: 0,
    engine: null,
    fellBack: false,
    timings: [],
    colorLocks: new Map(),
    lastQuantize: null,
  }),

  actions: {
    reset(): void {
      this.progressLabel = ''
      this.progressRatio = 0
      this.timings = []
      this.colorLocks.clear()
      this.lastQuantize = null
    },

    async voxelize(mesh: VoxelMesh, forceCpu = false): Promise<VoxelVolume> {
      const orderStore = useOrderStore()
      const order = orderStore.current
      if (!order?.project) throw new Error('请先选择订单')
      const settings = order.project.settings
      this.busy = true
      this.reset()
      try {
        const outcome = await runVoxelize(mesh, {
          resolution: settings.resolution,
          shellThickness: settings.shellThickness,
          voxelMm: settings.voxelMm,
          forceCpu,
          onProgress: (ratio, label) => {
            this.progressRatio = ratio
            this.progressLabel = label
          },
        })
        this.engine = outcome.engine
        this.fellBack = outcome.fellBack
        order.project.volume = outcome.volume
        order.project.brickPlan = null
        orderStore.setStatus(order.id, 'voxel')
        this.timings.push({
          stage: outcome.engine === 'webgpu' ? 'WebGPU 体素化' : 'CPU 体素化',
          elapsedMs: outcome.volume.stats.elapsedMs,
        })
        orderStore.persist()
        return outcome.volume
      } finally {
        this.busy = false
        this.progressLabel = ''
        this.progressRatio = 0
      }
    },

    applyColors(): QuantizeResult {
      const orderStore = useOrderStore()
      const vol = orderStore.current?.project?.volume
      const settings = orderStore.current?.project?.settings
      if (!vol || !settings) throw new Error('请先完成体素化')
      const result = quantizeColors(vol, this.colorLocks, settings.autoSubstitute)
      this.lastQuantize = result
      orderStore.setStatus(orderStore.current!.id, 'colored')
      orderStore.persist()
      return result
    },

    toggleLock(voxelIdx: number, colorIndex: number): void {
      if (this.colorLocks.has(voxelIdx)) {
        this.colorLocks.delete(voxelIdx)
      } else {
        this.colorLocks.set(voxelIdx, colorIndex)
      }
    },

    buildPlan(): void {
      const orderStore = useOrderStore()
      const project = orderStore.current?.project
      if (!project?.volume) throw new Error('请先完成体素化与配色')
      if (project.volume.colorIndex.includes(255)) {
        this.applyColors()
      }
      this.busy = true
      try {
        const plan = mergeBricks(project.volume, project.settings)
        project.brickPlan = plan
        orderStore.setStatus(orderStore.current!.id, 'planned')
        this.timings.push({ stage: '合砖 + 稳定性分析', elapsedMs: plan.elapsedMs })
        orderStore.persist()
      } finally {
        this.busy = false
      }
    },
  },
})
