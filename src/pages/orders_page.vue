<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ClipboardPlus,
  Download,
  FolderOpen,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import { exportOrderProject } from '../core/exporters/project_exporter'
import { importOrderProject } from '../core/exporters/project_exporter'
import type { Order, OrderStatus } from '../core/types'
import { formatNumber } from '../core/math_utils'
import { useOrderStore } from '../stores/order_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const toast = useToastStore()
const router = useRouter()

const showEditor = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ customer: '', name: '', note: '' })
const fileInput = ref<HTMLInputElement | null>(null)

const statusLabel: Record<OrderStatus, string> = {
  pending: '待处理',
  modeling: '已导入模型',
  voxel: '已体素化',
  colored: '已配色',
  planned: '已生成图纸',
  done: '已完成',
}

const statusClass: Record<OrderStatus, string> = {
  pending: 'st-pending',
  modeling: 'st-modeling',
  voxel: 'st-voxel',
  colored: 'st-colored',
  planned: 'st-planned',
  done: 'st-done',
}

const brickCount = (order: Order): number => order.project?.brickPlan?.bricks.length ?? 0
const voxelCount = (order: Order): number => order.project?.volume?.stats.total ?? 0

const openCreate = (): void => {
  editingId.value = null
  form.value = { customer: '', name: '', note: '' }
  showEditor.value = true
}

const openEdit = (order: Order): void => {
  editingId.value = order.id
  form.value = { customer: order.customer, name: order.name, note: order.note }
  showEditor.value = true
}

const save = (): void => {
  if (!form.value.customer.trim() || !form.value.name.trim()) {
    toast.error('客户名和订单名不能为空')
    return
  }
  if (editingId.value) {
    orderStore.updateOrder(editingId.value, { ...form.value })
    toast.success('订单已更新')
  } else {
    orderStore.createOrder({ ...form.value })
    toast.success('订单已创建')
  }
  showEditor.value = false
}

const remove = (order: Order): void => {
  if (!window.confirm(`确认删除订单「${order.name}」？该操作不可恢复`)) return
  orderStore.removeOrder(order.id)
  toast.success('订单已删除')
}

const open = (order: Order): void => {
  orderStore.selectOrder(order.id)
  router.push('/import')
}

const exportProject = (order: Order, event: Event): void => {
  event.stopPropagation()
  exportOrderProject(order)
  toast.success('工程文件已导出')
}

const triggerImport = (): void => fileInput.value?.click()

const onImportFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const order = await importOrderProject(file)
    orderStore.importExternal(order)
    toast.success(`工程「${order.name}」已导入`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '工程导入失败')
  }
  input.value = ''
}

const isEmpty = computed(() => orderStore.orders.length === 0)
</script>

<template>
  <section>
    <PageHeader title="订单列表" subtitle="管理定制订单与工程文件，支持 JSON 工程导入导出">
      <template #actions>
        <button class="btn" @click="triggerImport">
          <Upload :size="16" :stroke-width="1.8" /> 导入工程
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <ClipboardPlus :size="16" :stroke-width="1.8" /> 新建订单
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="onImportFile"
        />
      </template>
    </PageHeader>

    <div v-if="isEmpty" class="card empty-state">
      <FolderOpen :stroke-width="1.5" />
      <p class="title">还没有订单</p>
      <p class="subtitle">新建第一个宠物摆件订单，或导入已有工程继续设计</p>
      <button class="btn btn-primary" @click="openCreate">
        <ClipboardPlus :size="16" :stroke-width="1.8" /> 新建订单
      </button>
    </div>

    <div v-else class="table-card card">
      <table class="table">
        <thead>
          <tr>
            <th>订单名称</th>
            <th>客户</th>
            <th>状态</th>
            <th>体素数</th>
            <th>砖数</th>
            <th>更新时间</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="order in orderStore.orders"
            :key="order.id"
            class="row"
            @click="open(order)"
          >
            <td class="cell-strong">{{ order.name }}</td>
            <td>{{ order.customer }}</td>
            <td>
              <span class="chip" :class="statusClass[order.status]">
                {{ statusLabel[order.status] }}
              </span>
            </td>
            <td>{{ formatNumber(voxelCount(order)) }}</td>
            <td>{{ formatNumber(brickCount(order)) }}</td>
            <td class="cell-muted">{{ new Date(order.updatedAt).toLocaleString('zh-CN') }}</td>
            <td class="col-actions">
              <button class="icon-btn" title="编辑" @click.stop="openEdit(order)">
                <Pencil :size="16" :stroke-width="1.7" />
              </button>
              <button
                class="icon-btn"
                title="导出工程"
                :disabled="!order.project"
                @click="exportProject(order, $event)"
              >
                <Download :size="16" :stroke-width="1.7" />
              </button>
              <button class="icon-btn danger" title="删除" @click.stop="remove(order)">
                <Trash2 :size="16" :stroke-width="1.7" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showEditor" class="modal-mask" @click.self="showEditor = false">
      <div class="modal card">
        <h3 class="modal-title">{{ editingId ? '编辑订单' : '新建订单' }}</h3>
        <label class="label">客户名称</label>
        <input v-model="form.customer" class="input" placeholder="例如：陈女士" />
        <label class="label" style="margin-top: var(--sp-3)">订单名称</label>
        <input v-model="form.name" class="input" placeholder="例如：英短猫摆件" />
        <label class="label" style="margin-top: var(--sp-3)">备注</label>
        <textarea v-model="form.note" class="input" rows="3" placeholder="尺寸、颜色偏好等"></textarea>
        <div class="modal-actions">
          <button class="btn" @click="showEditor = false">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.table-card {
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-xs);
}

.table th {
  text-align: left;
  padding: var(--sp-3) var(--sp-4);
  background: var(--c-surface-2);
  color: var(--c-text-2);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}

.table td {
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--c-border);
  color: var(--c-text-2);
}

.row {
  cursor: pointer;
  transition: background var(--t-fast);
}

.row:hover {
  background: var(--c-surface-2);
}

.cell-strong {
  color: var(--c-text);
  font-weight: var(--fw-medium);
}

.cell-muted {
  color: var(--c-text-3);
  white-space: nowrap;
}

.col-actions {
  white-space: nowrap;
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: var(--sp-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-2);
  cursor: pointer;
  transition: all var(--t-fast);
}

.icon-btn:hover:not(:disabled) {
  background: var(--c-surface-2);
  border-color: var(--c-border);
  color: var(--c-text);
}

.icon-btn.danger:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.st-pending {
  color: var(--c-text-2);
}
.st-modeling {
  color: var(--c-primary);
  background: var(--c-primary-soft);
}
.st-voxel {
  color: var(--c-warning);
}
.st-colored {
  color: #7c3aed;
}
.st-planned,
.st-done {
  color: var(--c-success);
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.4);
  padding: var(--sp-4);
}

.modal {
  width: min(440px, 100%);
  padding: var(--sp-5);
}

.modal-title {
  margin-bottom: var(--sp-4);
  font-size: var(--fs-xl);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}
</style>
