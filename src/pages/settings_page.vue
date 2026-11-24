<script setup lang="ts">
import { computed } from 'vue'
import { Check, Database, Gauge, Package, Trash2 } from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import { BRICK_TYPES } from '../core/palette'
import { useOrderStore } from '../stores/order_store'
import { usePipelineStore } from '../stores/pipeline_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const pipeline = usePipelineStore()
const toast = useToastStore()

const settings = computed(() => orderStore.current?.project?.settings ?? null)

const toggleBrickType = (id: string): void => {
  if (!settings.value) return
  const list = settings.value.enabledBrickTypes
  const idx = list.indexOf(id)
  if (idx >= 0) {
    if (list.length === 1) {
      toast.error('至少保留一种砖型')
      return
    }
    list.splice(idx, 1)
  } else {
    list.push(id)
  }
  orderStore.persist()
}

const storageBytes = computed(() => {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) total += localStorage.getItem(key)?.length ?? 0
  }
  return total
})

const clearAll = (): void => {
  if (!window.confirm('确认清空全部本地订单数据？请先导出需要保留的工程')) return
  localStorage.removeItem('brick-forge:orders:v1')
  localStorage.removeItem('brick-forge:current-id:v1')
  orderStore.orders = []
  orderStore.currentId = null
  toast.success('本地数据已清空')
}

const timingRows = computed(() => pipeline.timings)
const meetsTarget = computed(
  () => pipeline.timings.reduce((sum, t) => sum + t.elapsedMs, 0) <= 10000,
)
</script>

<template>
  <section>
    <PageHeader title="设置" subtitle="砖型供给、结构策略与性能基准，随订单工程一起保存" />

    <div v-if="!settings" class="card empty-state">
      <Package :stroke-width="1.5" />
      <p class="title">尚未选择订单</p>
      <p class="subtitle">设置项绑定在订单工程上，请先创建或打开订单</p>
      <RouterLink class="btn btn-primary" to="/orders">去订单列表</RouterLink>
    </div>

    <div v-else class="settings-grid">
      <div class="card block">
        <h3 class="block-title">
          <Package :size="18" :stroke-width="1.7" /> 可用砖型
        </h3>
        <p class="block-text">取消勾选的砖型不会参与合砖，系统会用其余砖型重新咬合铺砖</p>
        <div class="brick-grid">
          <button
            v-for="t in BRICK_TYPES"
            :key="t.id"
            class="brick-chip"
            :class="{ on: settings.enabledBrickTypes.includes(t.id) }"
            @click="toggleBrickType(t.id)"
          >
            <span class="check">
              <Check v-if="settings.enabledBrickTypes.includes(t.id)" :size="13" :stroke-width="2.2" />
            </span>
            {{ t.label }}
          </button>
        </div>
      </div>

      <div class="card block">
        <h3 class="block-title">
          <Gauge :size="18" :stroke-width="1.7" /> 结构策略
        </h3>
        <label class="switch-row">
          <div>
            <p class="switch-title">自动加支撑</p>
            <p class="switch-sub">悬空体素下方自动补 1×1 支撑柱，保证无悬空</p>
          </div>
          <input v-model="settings.autoSupport" type="checkbox" class="switch" @change="orderStore.persist()" />
        </label>
        <label class="switch-row">
          <div>
            <p class="switch-title">缺货自动换色</p>
            <p class="switch-sub">色卡缺货时自动替换为 Lab 色域最近的在库色</p>
          </div>
          <input
            v-model="settings.autoSubstitute"
            type="checkbox"
            class="switch"
            @change="orderStore.persist()"
          />
        </label>
      </div>

      <div class="card block">
        <h3 class="block-title">
          <Gauge :size="18" :stroke-width="1.7" /> 性能基准（目标：十万体素 ≤ 10 秒）
        </h3>
        <div v-if="timingRows.length === 0" class="block-text">
          完成一次体素化与合砖后，这里展示各阶段实测耗时
        </div>
        <ul v-else class="timing-list">
          <li v-for="(t, i) in timingRows" :key="i" class="timing-row">
            <span>{{ t.stage }}</span>
            <strong>{{ t.elapsedMs.toFixed(0) }} ms</strong>
          </li>
          <li class="timing-row total" :class="{ pass: meetsTarget, fail: !meetsTarget }">
            <span>累计</span>
            <strong>{{ timingRows.reduce((s, t) => s + t.elapsedMs, 0).toFixed(0) }} ms</strong>
          </li>
        </ul>
      </div>

      <div class="card block danger-block">
        <h3 class="block-title">
          <Database :size="18" :stroke-width="1.7" /> 本地存储
        </h3>
        <p class="block-text">
          订单与工程保存在浏览器 localStorage，当前占用约
          <strong>{{ (storageBytes / 1024).toFixed(1) }} KB</strong>。大体积模型建议导出工程文件备份。
        </p>
        <button class="btn btn-danger" @click="clearAll">
          <Trash2 :size="16" :stroke-width="1.7" /> 清空全部本地数据
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
}

.block {
  padding: var(--sp-5);
}

.block-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-lg);
}

.block-text {
  margin: 0 0 var(--sp-4);
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  line-height: 1.7;
}

.brick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.brick-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  cursor: pointer;
  transition: all var(--t-fast);
}

.brick-chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.check {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--c-border);
}

.brick-chip.on .check {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--c-border);
}

.switch-row:last-child {
  border-bottom: none;
}

.switch-title {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.switch-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.switch {
  width: 40px;
  height: 22px;
  accent-color: var(--c-primary);
  cursor: pointer;
}

.timing-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.timing-row {
  display: flex;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  background: var(--c-surface-2);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.timing-row.total {
  font-weight: var(--fw-semibold);
}

.timing-row.total.pass {
  color: var(--c-success);
}

.timing-row.total.fail {
  color: var(--c-danger);
}

.danger-block {
  border-color: rgba(220, 38, 38, 0.3);
}
</style>
