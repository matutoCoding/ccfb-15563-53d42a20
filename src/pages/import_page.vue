<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Cat, FileUp, Home, Triangle } from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import { importMeshFile } from '../core/mesh/mesh_import'
import { createSampleCat, createSampleHouse } from '../core/procedural'
import type { VoxelMesh } from '../core/types'
import { formatNumber } from '../core/math_utils'
import { getLiveMesh, setLiveMesh, useOrderStore } from '../stores/order_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const toast = useToastStore()
const router = useRouter()

const loading = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const localMesh = ref<VoxelMesh | null>(getLiveMesh())

const hasOrder = computed(() => orderStore.current !== null)
const meshInfo = computed(() => {
  const mesh = localMesh.value
  if (!mesh) return null
  return [
    { label: '文件名', value: mesh.fileName },
    { label: '三角面数', value: formatNumber(mesh.triangleCount) },
    { label: '归一化半径', value: mesh.boundsRadius.toFixed(3) },
  ]
})

const handleFiles = async (files: FileList | null): Promise<void> => {
  if (!files || files.length === 0) return
  if (!hasOrder.value) {
    toast.error('请先在订单列表创建或选择订单')
    return
  }
  const main = [...files].find((f) => /\.(obj|gltf|glb)$/i.test(f.name))
  if (!main) {
    toast.error('未找到 OBJ 或 glTF/GLB 主文件')
    return
  }
  loading.value = true
  try {
    const mesh = await importMeshFile(main, [...files])
    localMesh.value = mesh
    orderStore.attachMesh(mesh)
    toast.success(`模型「${mesh.fileName}」导入成功，共 ${formatNumber(mesh.triangleCount)} 面`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '模型导入失败')
  } finally {
    loading.value = false
  }
}

const onDrop = (event: DragEvent): void => {
  dragOver.value = false
  void handleFiles(event.dataTransfer?.files ?? null)
}

const useSample = (kind: 'cat' | 'house'): void => {
  if (!hasOrder.value) {
    toast.error('请先在订单列表创建或选择订单')
    return
  }
  const mesh = kind === 'cat' ? createSampleCat() : createSampleHouse()
  localMesh.value = mesh
  setLiveMesh(mesh)
  orderStore.attachMesh(mesh)
  toast.success(kind === 'cat' ? '已生成程序化坐猫模型' : '已生成程序化小房子模型')
}

const goVoxelize = (): void => {
  void router.push('/voxelize')
}
</script>

<template>
  <section>
    <PageHeader title="模型导入" subtitle="支持 OBJ（含 MTL 与贴图）和 glTF/GLB，自动归一化与贴图烘焙">
      <template #actions>
        <button class="btn btn-primary" :disabled="!localMesh" @click="goVoxelize">
          下一步：体素化
        </button>
      </template>
    </PageHeader>

    <div v-if="!hasOrder" class="card empty-state">
      <Triangle :stroke-width="1.5" />
      <p class="title">尚未选择订单</p>
      <p class="subtitle">请先到订单列表新建或打开一个订单，再导入客户模型</p>
      <RouterLink class="btn btn-primary" to="/orders">去订单列表</RouterLink>
    </div>

    <template v-else>
      <div
        class="dropzone card"
        :class="{ active: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
        @click="fileInput?.click()"
      >
        <FileUp :size="40" :stroke-width="1.5" />
        <p class="title">拖拽 OBJ / glTF / GLB 到这里，或点击选择</p>
        <p class="subtitle">OBJ 请连同 .mtl 与贴图文件一起多选拖入</p>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".obj,.mtl,.gltf,.glb,.png,.jpg,.jpeg,.webp"
          hidden
          @change="handleFiles(($event.target as HTMLInputElement).files)"
        />
        <div v-if="loading" class="loading-row">
          <span class="spinner"></span>
          <span>正在解析与烘焙贴图…</span>
        </div>
      </div>

      <div class="sample-grid">
        <button class="sample-card card" @click="useSample('cat')">
          <Cat :size="28" :stroke-width="1.6" />
          <span class="sample-title">生成坐猫</span>
          <span class="sample-sub">没有客户模型时的程序化样例</span>
        </button>
        <button class="sample-card card" @click="useSample('house')">
          <Home :size="28" :stroke-width="1.6" />
          <span class="sample-title">生成小房子</span>
          <span class="sample-sub">含坡屋顶、门窗与烟囱的样例</span>
        </button>
      </div>

      <div v-if="meshInfo" class="card info-card">
        <h3 class="info-title">当前网格</h3>
        <dl class="info-list">
          <div v-for="item in meshInfo" :key="item.label" class="info-row">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-7) var(--sp-5);
  border: 1.5px dashed var(--c-border);
  cursor: pointer;
  color: var(--c-text-3);
  transition:
    border-color var(--t-fast),
    background var(--t-fast);
}

.dropzone:hover,
.dropzone.active {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.dropzone .title {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-medium);
  color: var(--c-text-2);
}

.dropzone .subtitle {
  margin: 0;
  font-size: var(--fs-xs);
}

.loading-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sample-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
  margin-top: var(--sp-4);
}

.sample-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-1);
  padding: var(--sp-5);
  cursor: pointer;
  color: var(--c-text-2);
  transition:
    box-shadow var(--t-fast),
    transform var(--t-fast);
}

.sample-card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.sample-title {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  color: var(--c-text);
}

.sample-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.info-card {
  margin-top: var(--sp-4);
  padding: var(--sp-5);
}

.info-title {
  margin-bottom: var(--sp-3);
  font-size: var(--fs-lg);
}

.info-list {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-4);
}

.info-row dt {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.info-row dd {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
</style>
