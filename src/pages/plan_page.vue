<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileImage,
  FileText,
  Hammer,
  Layers,
} from 'lucide-vue-next'

import PageHeader from '../components/page_header.vue'
import VoxelViewer from '../components/voxel_viewer.vue'
import { buildBom, estimateVolumeMm3, layerStats, totalBrickCount } from '../core/bom'
import { exportBomCsv, exportRenderPng } from '../core/exporters/csv_png_exporter'
import { exportPlanPdf, type StepSnapshot } from '../core/exporters/pdf_exporter'
import { formatMs, formatNumber } from '../core/math_utils'
import { useOrderStore } from '../stores/order_store'
import { usePipelineStore } from '../stores/pipeline_store'
import { useToastStore } from '../stores/toast_store'

const orderStore = useOrderStore()
const pipeline = usePipelineStore()
const toast = useToastStore()

const viewerRef = ref<InstanceType<typeof VoxelViewer> | null>(null)
const stepCursor = ref(0)
const exporting = ref(false)

const project = computed(() => orderStore.current?.project ?? null)
const volume = computed(() => project.value?.volume ?? null)
const plan = computed(() => project.value?.brickPlan ?? null)
const settings = computed(() => project.value?.settings ?? null)
// 渲染用含自动支撑柱的工作副本，保证砖与体素格完全对齐
const renderVolume = computed(() => plan.value?.volume ?? volume.value)

const build = (): void => {
  try {
    pipeline.buildPlan()
    stepCursor.value = 0
    toast.success('合砖完成，已生成搭建步骤')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '合砖失败')
  }
}

watch(plan, (p) => {
  if (p) stepCursor.value = Math.min(stepCursor.value, p.steps.length - 1)
})

const currentStep = computed(() => plan.value?.steps[stepCursor.value] ?? null)
const highlightIds = computed(() => new Set(currentStep.value?.brickIds ?? []))
const visibleLayer = computed(() => currentStep.value?.layer)

const bomRows = computed(() => (plan.value ? buildBom(plan.value) : []))
const layers = computed(() => (plan.value ? layerStats(plan.value) : []))

const issueKindLabel: Record<string, string> = {
  floating: '悬空',
  weak: '弱连接',
  'unsupported-span': '支撑不足',
}

const goStep = (delta: number): void => {
  if (!plan.value) return
  stepCursor.value = Math.min(
    plan.value.steps.length - 1,
    Math.max(0, stepCursor.value + delta),
  )
}

const exportCsv = (): void => {
  if (!plan.value || !orderStore.current) return
  exportBomCsv(plan.value, orderStore.current.name)
  toast.success('零件清单 CSV 已导出')
}

const exportPng = (): void => {
  const canvas = viewerRef.value?.snapshot()
  if (!canvas || !orderStore.current) return
  exportRenderPng(canvas, orderStore.current.name)
  toast.success('成品效果图已导出')
}

const exportPdf = async (): Promise<void> => {
  if (!plan.value || !orderStore.current || !viewerRef.value) return
  exporting.value = true
  try {
    const snapshots: StepSnapshot[] = []
    for (let i = 0; i < plan.value.steps.length; i++) {
      stepCursor.value = i
      await nextFrame()
      const canvas = viewerRef.value.snapshot()
      if (!canvas) continue
      snapshots.push({
        stepIndex: i,
        layer: plan.value.steps[i].layer,
        canvas,
        addedBrickCount: plan.value.steps[i].brickIds.length,
      })
    }
    await exportPlanPdf(snapshots, plan.value, orderStore.current.name)
    toast.success('分步图纸 PDF 已导出')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'PDF 导出失败')
  } finally {
    exporting.value = false
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

const estimatedMl = computed(() => {
  if (!plan.value || !settings.value) return 0
  return estimateVolumeMm3(plan.value, settings.value) / 1000
})
</script>

<template>
  <section>
    <PageHeader title="搭建图纸" subtitle="合砖咬合、稳定性分析、分步搭建与导出">
      <template #actions>
        <template v-if="plan">
          <button class="btn" @click="exportCsv">
            <FileSpreadsheet :size="16" :stroke-width="1.7" /> 零件 CSV
          </button>
          <button class="btn" :disabled="exporting" @click="exportPdf">
            <FileText :size="16" :stroke-width="1.7" /> 图纸 PDF
          </button>
          <button class="btn" @click="exportPng">
            <FileImage :size="16" :stroke-width="1.7" /> 效果图
          </button>
        </template>
        <button class="btn btn-primary" :disabled="!volume || pipeline.busy" @click="build">
          <Hammer :size="16" :stroke-width="1.7" /> {{ plan ? '重新合砖' : '开始合砖' }}
        </button>
      </template>
    </PageHeader>

    <div v-if="!volume" class="card empty-state">
      <Layers :stroke-width="1.5" />
      <p class="title">还没有体素模型</p>
      <p class="subtitle">先完成体素化与配色，才能生成搭建图纸</p>
      <RouterLink class="btn btn-primary" to="/voxelize">去体素化</RouterLink>
    </div>

    <template v-else>
      <div class="plan-grid">
        <div class="card viewer-card">
          <VoxelViewer
            ref="viewerRef"
            :volume="renderVolume"
            :bricks="plan?.bricks"
            :max-layer="visibleLayer"
            :highlight-ids="highlightIds"
            mode="bricks"
          />
          <div v-if="currentStep" class="step-bar">
            <button class="btn btn-sm" :disabled="stepCursor === 0" @click="goStep(-1)">
              <ChevronLeft :size="15" :stroke-width="1.8" /> 上一步
            </button>
            <div class="step-info">
              <strong>第 {{ stepCursor + 1 }} / {{ plan?.steps.length }} 步</strong>
              <span>第 {{ (currentStep.layer ?? 0) + 1 }} 层 · 新增 {{ currentStep.brickIds.length }} 块</span>
            </div>
            <button
              class="btn btn-sm"
              :disabled="!plan || stepCursor === plan.steps.length - 1"
              @click="goStep(1)"
            >
              下一步 <ChevronRight :size="15" :stroke-width="1.8" />
            </button>
          </div>
        </div>

        <div class="side">
          <div v-if="plan" class="card block">
            <h3 class="block-title">合砖概览</h3>
            <dl class="metric-grid">
              <div>
                <dt>总砖数</dt>
                <dd>{{ formatNumber(totalBrickCount(plan)) }}</dd>
              </div>
              <div>
                <dt>层数</dt>
                <dd>{{ layers.length }}</dd>
              </div>
              <div>
                <dt>体积估算</dt>
                <dd>{{ estimatedMl.toFixed(1) }} cm³</dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{{ formatMs(plan.elapsedMs) }}</dd>
              </div>
            </dl>
          </div>

          <div class="card block">
            <h3 class="block-title">
              稳定性分析
              <span v-if="plan" class="chip" :class="plan.issues.length ? 'chip-warn' : 'chip-ok'">
                {{ plan.issues.length ? `${plan.issues.length} 项提示` : '全部通过' }}
              </span>
            </h3>
            <div v-if="!plan" class="block-text">完成合砖后自动检查悬空、单颗粒连接与支撑覆盖率</div>
            <div v-else-if="plan.issues.length === 0" class="ok-line">
              <CheckCircle2 :size="16" :stroke-width="1.8" />
              每块砖均与上下层咬合，无悬空结构
            </div>
            <ul v-else class="issue-list">
              <li v-for="(issue, i) in plan.issues" :key="i" class="issue-item">
                <AlertTriangle :size="15" :stroke-width="1.8" />
                <div>
                  <span class="issue-kind">{{ issueKindLabel[issue.kind] }}</span>
                  <p>{{ issue.message }}</p>
                </div>
              </li>
            </ul>
          </div>

          <div v-if="plan" class="card block">
            <h3 class="block-title">零件清单</h3>
            <div class="bom-scroll">
              <table class="bom-table">
                <thead>
                  <tr>
                    <th>砖型</th>
                    <th>颜色</th>
                    <th class="num">数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in bomRows" :key="`${row.typeId}-${row.colorId}-${row.isSupport}`">
                    <td>
                      {{ row.typeLabel }}
                      <span v-if="row.isSupport" class="support-tag">支撑</span>
                    </td>
                    <td>
                      <span class="color-dot" :style="{ background: row.hex }"></span>
                      {{ row.colorName }}
                    </td>
                    <td class="num">{{ row.count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plan-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--sp-4);
  align-items: start;
}

.viewer-card {
  display: flex;
  flex-direction: column;
  min-height: 540px;
  padding: 0;
  overflow: hidden;
}

.viewer-card :deep(.viewer-wrap) {
  flex: 1;
}

.step-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--c-border);
}

.step-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.step-info strong {
  color: var(--c-text);
  font-size: var(--fs-sm);
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

.chip-ok {
  color: var(--c-success);
}

.chip-warn {
  color: var(--c-warning);
}

.block-text {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.metric-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.metric-grid dt {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.metric-grid dd {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
}

.ok-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-success);
}

.issue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.issue-item {
  display: flex;
  gap: var(--sp-2);
  color: var(--c-warning);
  font-size: var(--fs-xs);
}

.issue-item p {
  margin: 2px 0 0;
  color: var(--c-text-2);
}

.issue-kind {
  font-weight: var(--fw-semibold);
}

.bom-scroll {
  max-height: 280px;
  overflow: auto;
}

.bom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-xs);
}

.bom-table th {
  position: sticky;
  top: 0;
  text-align: left;
  padding: var(--sp-2);
  background: var(--c-surface-2);
  color: var(--c-text-2);
  font-weight: var(--fw-medium);
}

.bom-table td {
  padding: var(--sp-2);
  border-top: 1px solid var(--c-border);
  color: var(--c-text-2);
}

.bom-table .num {
  text-align: right;
  font-weight: var(--fw-medium);
}

.color-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.12);
  vertical-align: middle;
}

.support-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 11px;
}
</style>
