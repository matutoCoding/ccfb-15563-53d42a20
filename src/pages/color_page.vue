<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, Lock, LockOpen, Palette as PaletteIcon, Shuffle } from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import VoxelViewer from '../components/voxel_viewer.vue'
import { quantizeColors } from '../core/color_quantize'
import { PALETTE, getPaletteColor } from '../core/palette'
import { formatNumber } from '../core/math_utils'
import type { QuantizeResult } from '../core/color_quantize'
import { useOrderStore } from '../stores/order_store'
import { usePipelineStore } from '../stores/pipeline_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const pipeline = usePipelineStore()
const toast = useToastStore()

const viewerRef = ref<InstanceType<typeof VoxelViewer> | null>(null)
const result = ref<QuantizeResult | null>(null)
const selectedColor = ref<number>(0)

const project = computed(() => orderStore.current?.project ?? null)
const volume = computed(() => project.value?.volume ?? null)
const settings = computed(() => project.value?.settings ?? null)

const hasColor = computed(() => {
  const vol = volume.value
  return !!vol && !vol.colorIndex.includes(255)
})

const runQuantize = (): void => {
  if (!volume.value || !settings.value) return
  try {
    result.value = quantizeColors(
      volume.value,
      pipeline.colorLocks,
      settings.value.autoSubstitute,
    )
    orderStore.setStatus(orderStore.current!.id, 'colored')
    orderStore.persist()
    toast.success(
      `配色完成，锁定 ${result.value.lockedCount} 颗，替换缺货色 ${result.value.substitutions.size} 种`,
    )
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '配色失败')
  }
}

const usageRows = computed(() => {
  if (!result.value) return []
  return [...result.value.usage.entries()]
    .map(([colorId, count]) => ({ color: getPaletteColor(colorId), count }))
    .sort((a, b) => b.count - a.count)
})

const totalUsage = computed(() =>
  usageRows.value.reduce((sum, row) => sum + row.count, 0),
)

const substitutionRows = computed(() => {
  if (!result.value) return []
  return [...result.value.substitutions.entries()].map(([from, to]) => ({
    from: getPaletteColor(from),
    to: getPaletteColor(to),
  }))
})

/** 射线拾取颗粒并切换锁定颜色 */
const onPickVoxel = (event: MouseEvent): void => {
  const vol = volume.value
  if (!vol || !hasColor.value) return
  const idx = viewerRef.value?.pickVoxel(event.clientX, event.clientY)
  if (idx === null || idx === undefined) return
  pipeline.toggleLock(idx, selectedColor.value)
  toast.push(
    pipeline.colorLocks.has(idx)
      ? `已锁定为「${getPaletteColor(selectedColor.value).name}」`
      : '已解除锁定',
    'info',
  )
  runQuantize()
}

const lockCount = computed(() => pipeline.colorLocks.size)
</script>

<template>
  <section>
    <PageHeader title="配色" subtitle="贴图颜色量化到颗粒色卡，支持逐颗锁定与缺货自动换色">
      <template #actions>
        <button class="btn btn-primary" :disabled="!volume" @click="runQuantize">
          <Shuffle :size="16" :stroke-width="1.7" /> 量化配色
        </button>
      </template>
    </PageHeader>

    <div v-if="!volume" class="card empty-state">
      <PaletteIcon :stroke-width="1.5" />
      <p class="title">还没有体素模型</p>
      <p class="subtitle">请先在体素化页面生成颗粒体积</p>
      <RouterLink class="btn btn-primary" to="/voxelize">去体素化</RouterLink>
    </div>

    <div v-else class="color-grid">
      <div class="panel card viewer-panel">
        <VoxelViewer ref="viewerRef" :volume="volume" mode="voxels" @click="onPickVoxel" />
      </div>

      <div class="side">
        <div class="card block">
          <h3 class="block-title">
            颗粒色卡
            <span class="chip">{{ PALETTE.length }} 色</span>
          </h3>
          <div class="palette-grid">
            <button
              v-for="color in PALETTE"
              :key="color.id"
              class="swatch"
              :class="{ selected: selectedColor === color.id, out: !color.inStock }"
              :title="color.name"
              @click="selectedColor = color.id"
            >
              <span class="swatch-color" :style="{ background: color.hex }"></span>
              <span class="swatch-name">{{ color.name }}</span>
              <span v-if="!color.inStock" class="out-tag">缺货</span>
            </button>
          </div>
        </div>

        <div class="card block">
          <h3 class="block-title">
            颜色锁定
            <span class="chip">
              <Lock :size="13" :stroke-width="1.8" /> {{ lockCount }}
            </span>
          </h3>
          <p class="block-text">
            在左侧模型上点击颗粒，可将其锁定为当前选中的
            <strong>{{ getPaletteColor(selectedColor).name }}</strong
            >，再次点击解除。锁定色在重新量化时保持不变。
          </p>
          <button
            class="btn btn-sm"
            :disabled="lockCount === 0"
            @click="pipeline.colorLocks.clear(); runQuantize()"
          >
            <LockOpen :size="14" :stroke-width="1.7" /> 清除全部锁定
          </button>
        </div>

        <div v-if="substitutionRows.length" class="card block warn-block">
          <h3 class="block-title">
            <AlertTriangle :size="16" :stroke-width="1.8" /> 缺货替换
          </h3>
          <div v-for="row in substitutionRows" :key="row.from.id" class="sub-row">
            <span class="dot" :style="{ background: row.from.hex }"></span>
            <span>{{ row.from.name }}</span>
            <span class="arrow">→</span>
            <span class="dot" :style="{ background: row.to.hex }"></span>
            <span>{{ row.to.name }}</span>
          </div>
        </div>

        <div v-if="usageRows.length" class="card block">
          <h3 class="block-title">用量统计 · 共 {{ formatNumber(totalUsage) }} 颗</h3>
          <div class="usage-list">
            <div v-for="row in usageRows" :key="row.color.id" class="usage-row">
              <span class="dot" :style="{ background: row.color.hex }"></span>
              <span class="usage-name">{{ row.color.name }}</span>
              <div class="usage-bar">
                <div
                  class="usage-fill"
                  :style="{
                    width: `${(row.count / totalUsage) * 100}%`,
                    background: row.color.hex,
                  }"
                ></div>
              </div>
              <span class="usage-count">{{ formatNumber(row.count) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.color-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--sp-4);
  align-items: start;
}

.viewer-panel {
  position: relative;
  min-height: 520px;
  padding: 0;
  overflow: hidden;
  cursor: crosshair;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.block {
  padding: var(--sp-4);
}

.block-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-base);
}

.block-text {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  line-height: 1.7;
}

.palette-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-2);
}

.swatch {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  cursor: pointer;
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast);
}

.swatch.selected {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 1px var(--c-primary);
}

.swatch-color {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.12);
}

.swatch-name {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.swatch.out .swatch-color {
  opacity: 0.45;
}

.out-tag {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 10px;
  color: var(--c-danger);
}

.warn-block {
  border-color: var(--c-warning);
}

.sub-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  padding: var(--sp-1) 0;
}

.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.12);
}

.arrow {
  color: var(--c-text-3);
}

.usage-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.usage-row {
  display: grid;
  grid-template-columns: 14px minmax(60px, auto) 1fr auto;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
}

.usage-name {
  color: var(--c-text-2);
}

.usage-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--c-surface-2);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
}

.usage-count {
  font-weight: var(--fw-medium);
}
</style>
