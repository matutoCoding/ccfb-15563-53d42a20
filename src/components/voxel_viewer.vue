<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { BrickViewer } from '../core/viewer/brick_viewer'
import type { Brick, VoxelVolume } from '../core/types'

const props = defineProps<{
  volume: VoxelVolume | null
  bricks?: Brick[]
  maxLayer?: number
  highlightIds?: Set<number>
  mode: 'voxels' | 'bricks'
}>()

const emit = defineEmits<{ ready: [viewer: BrickViewer] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let viewer: BrickViewer | null = null

const render = (): void => {
  if (!viewer || !props.volume) return
  if (props.mode === 'bricks' && props.bricks) {
    viewer.showBricks(props.volume, props.bricks, {
      maxLayer: props.maxLayer,
      highlightIds: props.highlightIds,
    })
  } else {
    viewer.showVoxels(props.volume, { maxLayer: props.maxLayer })
  }
}

onMounted(() => {
  if (!canvasRef.value) return
  viewer = new BrickViewer(canvasRef.value)
  emit('ready', viewer)
  window.addEventListener('resize', handleResize)
  render()
})

const handleResize = (): void => viewer?.resize()

watch(
  () => [props.volume, props.bricks, props.maxLayer, props.highlightIds, props.mode],
  render,
  { deep: false },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  viewer?.dispose()
  viewer = null
})

defineExpose({
  snapshot: (): HTMLCanvasElement | null => viewer?.snapshot() ?? null,
  pickVoxel: (clientX: number, clientY: number): number | null =>
    viewer?.pickVoxel(clientX, clientY) ?? null,
  viewer: (): BrickViewer | null => viewer,
})
</script>

<template>
  <div class="viewer-wrap">
    <canvas ref="canvasRef" class="viewer-canvas"></canvas>
    <div v-if="!volume" class="viewer-empty">
      <p class="title">暂无三维内容</p>
      <p class="subtitle">完成体素化或合砖后，这里会显示可旋转的颗粒模型</p>
    </div>
  </div>
</template>

<style scoped>
.viewer-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--c-surface-2);
}

.viewer-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.viewer-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--c-text-3);
  pointer-events: none;
}

.viewer-empty .title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-medium);
  color: var(--c-text-2);
}

.viewer-empty .subtitle {
  margin: 0;
  font-size: var(--fs-xs);
}
</style>
