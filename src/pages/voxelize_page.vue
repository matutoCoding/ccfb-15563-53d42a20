<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Cpu, Play, RotateCcw, Zap } from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import VoxelViewer from '../components/voxel_viewer.vue'
import { isWebGpuSupported } from '../core/voxel/gpu_voxelizer'
import { createSampleCat, createSampleHouse } from '../core/procedural'
import { formatMs, formatNumber } from '../core/math_utils'
import { getLiveMesh, useOrderStore } from '../stores/order_store'
import { usePipelineStore } from '../stores/pipeline_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const pipeline = usePipelineStore()
const toast = useToastStore()

const webgpuAvailable = isWebGpuSupported()
const forceCpu = ref(false)
const layerVisible = ref<number | null>(null)

const project = computed(() => orderStore.current?.project ?? null)
const volume = computed(() => project.value?.volume ?? null)
const settings = computed(() => project.value?.settings)

const maxLayer = computed(() => {
  if (layerVisible.value !== null) return layerVisible.value
  return volume.value ? volume.value.size[2] - 1 : undefined
})

watch(
  volume,
  (vol) => {
    layerVisible.value = vol ? vol.size[2] - 1 : null
  },
  { immediate: true },
)

const run = async (): Promise<void> => {
  let mesh = getLiveMesh()
  if (!mesh) {
    // 刷新后运行时态丢失：用与订单同名的程序化模型兜底
    mesh = orderStore.current?.name.includes('房') ? createSampleHouse() : createSampleCat()
    orderStore.attachMesh(mesh)
    toast.push('原网格已随页面刷新丢失，已用程序化模型替代', 'info')
  }
  try {
    await pipeline.voxelize(mesh, forceCpu.value)
    forceCpu.value = false
    layerVisible.value = volume.value?.size[2] ? volume.value.size[2] - 1 : null
    toast.success('体素化完成')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '体素化失败')
  }
}

const rerunWithCpu = async (): Promise<void> => {
  forceCpu.value = true
  await run()
}

const stats = computed(() => {
  const vol = volume.value
  if (!vol) return []
  return [
    { label: '网格尺寸', value: vol.size.join(' × ') },
    { label: '实心体素', value: formatNumber(vol.stats.total) },
    { label: '表面体素', value: formatNumber(vol.stats.surface) },
    { label: '掏空体素', value: formatNumber(vol.stats.hollowed) },
    { label: '颗粒尺寸', value: `${vol.voxelMm} mm` },
    { label: '壳厚', value: `${vol.stats.shellThickness} 格` },
    { label: '计算引擎', value: vol.stats.engine === 'webgpu' ? 'WebGPU' : 'CPU' },
    { label: '耗时', value: formatMs(vol.stats.elapsedMs) },
  ]
})
</script>

<template>
  <section>
    <PageHeader title="体素化" subtitle="WebGPU 计算着色器按颗粒尺寸栅格化，等厚掏空省料且薄颈不断">
      <template #actions>
        <button class="btn" :disabled="pipeline.busy || !webgpuAvailable" @click="rerunWithCpu">
          <Cpu :size="16" :stroke-width="1.7" /> 强制 CPU 重算
        </button>
        <button class="btn btn-primary" :disabled="pipeline.busy || !settings" @click="run">
          <Play :size="16" :stroke-width="1.7" />
          {{ volume ? '重新体素化' : '开始体素化' }}
        </button>
      </template>
    </PageHeader>

    <div class="engine-bar card">
      <div class="engine-item" :class="{ ok: webgpuAvailable }">
        <Zap :size="18" :stroke-width="1.7" />
        <span>WebGPU {{ webgpuAvailable ? '可用，优先走计算着色器' : '不可用，将使用 CPU 路径' }}</span>
      </div>
      <div v-if="pipeline.fellBack" class="engine-item warn">
        <RotateCcw :size="16" :stroke-width="1.7" />
        <span>GPU 执行异常，已自动降级 CPU，结果一致</span>
      </div>
    </div>

    <div class="work-grid">
      <div class="panel card controls">
        <h3 class="panel-title">参数</h3>

        <label class="label">
          分辨率（最长边颗粒数）：<strong>{{ settings?.resolution }}</strong>
        </label>
        <input
          v-if="settings"
          v-model.number="settings.resolution"
          type="range"
          min="32"
          max="160"
          step="8"
          class="range"
        />
        <p class="hint">分辨率越高细节越多，十万体素内 GPU 可在十秒内完成</p>

        <label class="label" style="margin-top: var(--sp-4)">
          壳厚：<strong>{{ settings?.shellThickness }}</strong> 格
        </label>
        <input
          v-if="settings"
          v-model.number="settings.shellThickness"
          type="range"
          min="1"
          max="4"
          step="1"
          class="range"
        />
        <p class="hint">基于到表面距离场掏空，厚度不足的连接处会自动保留</p>

        <label class="label" style="margin-top: var(--sp-4)">
          单颗粒尺寸：<strong>{{ settings?.voxelMm }}</strong> mm
        </label>
        <input
          v-if="settings"
          v-model.number="settings.voxelMm"
          type="range"
          min="4"
          max="16"
          step="1"
          class="range"
        />

        <div v-if="volume" class="layer-block">
          <label class="label">
            分层预览：第 <strong>{{ (layerVisible ?? 0) + 1 }}</strong> / {{ volume.size[2] }} 层
          </label>
          <input
            v-model.number="layerVisible"
            type="range"
            :min="0"
            :max="volume.size[2] - 1"
            step="1"
            class="range"
          />
        </div>

        <div v-if="pipeline.busy" class="progress-block">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${Math.round(pipeline.progressRatio * 100)}%` }"></div>
          </div>
          <p class="hint">{{ pipeline.progressLabel }} · {{ Math.round(pipeline.progressRatio * 100) }}%</p>
        </div>
      </div>

      <div class="panel viewer-panel">
        <VoxelViewer :volume="volume" :max-layer="maxLayer" mode="voxels" />
      </div>
    </div>

    <div v-if="volume" class="card stats-card">
      <h3 class="panel-title">体素统计</h3>
      <dl class="stats-grid">
        <div v-for="item in stats" :key="item.label" class="stat">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.engine-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
  font-size: var(--fs-xs);
}

.engine-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text-2);
}

.engine-item.ok {
  color: var(--c-success);
}

.engine-item.warn {
  color: var(--c-warning);
}

.work-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: var(--sp-4);
}

.panel {
  padding: var(--sp-4);
}

.controls {
  display: flex;
  flex-direction: column;
}

.panel-title {
  margin: 0 0 var(--sp-4);
  font-size: var(--fs-lg);
}

.range {
  width: 100%;
  accent-color: var(--c-primary);
}

.hint {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.layer-block {
  margin-top: var(--sp-5);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--c-border);
}

.progress-block {
  margin-top: var(--sp-5);
}

.progress-track {
  height: 6px;
  border-radius: 999px;
  background: var(--c-surface-2);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--c-primary);
  transition: width var(--t-fast);
}

.viewer-panel {
  min-height: 480px;
  padding: 0;
  overflow: hidden;
}

.stats-card {
  margin-top: var(--sp-4);
  padding: var(--sp-5);
}

.stats-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-4);
}

.stat dt {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.stat dd {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
}
</style>
