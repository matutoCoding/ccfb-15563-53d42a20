/**
 * 核心算法冒烟测试（Node 环境，经 tsx 运行）
 * 覆盖：程序化模型 -> CPU 体素化 -> 掏空 -> 配色 -> 合砖 -> 结构红线
 * 运行：pnpm test:smoke
 */
import { createSampleCat, createSampleHouse } from '../src/core/procedural'
import { voxelizeCpu } from '../src/core/voxel/cpu_voxelizer'
import { quantizeColors } from '../src/core/color_quantize'
import { mergeBricks } from '../src/core/brick_merger'
import { voxelIndex } from '../src/core/grid_utils'
import { DEFAULT_BRICK_TYPE_IDS } from '../src/core/palette'
import type { PipelineSettings, VoxelVolume } from '../src/core/types'

let failures = 0
const assert = (cond: boolean, message: string): void => {
  if (cond) {
    console.log(`  ✓ ${message}`)
  } else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const makeSettings = (resolution: number): PipelineSettings => ({
  resolution,
  shellThickness: 2,
  voxelMm: 8,
  autoSupport: true,
  autoSubstitute: true,
  enabledBrickTypes: [...DEFAULT_BRICK_TYPE_IDS],
})

/** 检查所有实心格是否都已配色（掏空格 occupancy=2 不要求配色） */
const solidCellsAllColored = (vol: VoxelVolume): boolean => {
  for (let i = 0; i < vol.occupancy.length; i++) {
    if (vol.occupancy[i] === 1 && vol.colorIndex[i] === 255) return false
  }
  return true
}

const verifyStructure = (vol: VoxelVolume, label: string): void => {
  console.log(`\n[${label}] 结构红线验证`)
  const plan = mergeBricks(vol, makeSettings(vol.stats.maxResolution))
  const work = plan.volume // 含自动支撑柱的工作副本，结构检查必须基于它
  const [sx] = work.size

  // 1. 无悬空：每块非底层砖足迹下至少一格咬住下层实体（允许桥接）
  let floating = 0
  for (const b of plan.bricks) {
    if (b.z === 0) continue
    const lower = plan.layerOwner[b.z - 1]
    if (!lower) {
      floating++
      continue
    }
    let supported = 0
    for (let dy = 0; dy < b.d; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        if (lower[(b.y + dy) * sx + b.x + dx] > 0) supported++
      }
    }
    if (supported === 0) floating++
  }
  assert(floating === 0, `无悬空砖（实测悬空 ${floating}）`)

  // 2. 全覆盖且无重叠：每个实心格被恰好一块砖拥有
  const covered = new Map<number, number>()
  let overlap = 0
  for (const b of plan.bricks) {
    for (let dy = 0; dy < b.d; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const idx = voxelIndex(work.size, b.x + dx, b.y + dy, b.z)
        if (covered.has(idx)) overlap++
        covered.set(idx, b.id)
      }
    }
  }
  let solidCount = 0
  for (const o of work.occupancy) if (o === 1) solidCount++
  assert(overlap === 0, `砖足迹无重叠（冲突 ${overlap}）`)
  assert(covered.size === solidCount, `全部实心格被覆盖（${covered.size}/${solidCount}）`)

  // 3. 步骤连续性
  const stepBrickCount = plan.steps.reduce((s, st) => s + st.brickIds.length, 0)
  const sorted = plan.steps.every((st, i, arr) => i === 0 || st.layer >= arr[i - 1].layer)
  assert(stepBrickCount === plan.bricks.length, `步骤覆盖全部砖（${stepBrickCount}/${plan.bricks.length}）`)
  assert(sorted, '步骤按层自底向上排列')

  // 4. 交错咬合统计（软目标）：非底层、非支撑砖中跨 ≥2 块下层砖的比例
  let interlockable = 0
  let interlocked = 0
  for (const b of plan.bricks) {
    if (b.z === 0 || b.isSupport) continue
    const lower = plan.layerOwner[b.z - 1]
    if (!lower) continue
    interlockable++
    const ids = new Set<number>()
    for (let dy = 0; dy < b.d; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const id = lower[(b.y + dy) * sx + b.x + dx]
        if (id > 0) ids.add(id)
      }
    }
    if (ids.size >= 2) interlocked++
  }
  const ratio = interlockable ? ((interlocked / interlockable) * 100).toFixed(1) : '100'
  console.log(`  交错咬合率：${ratio}%（${interlocked}/${interlockable}，1x1 边缘残格除外）`)

  const supportCount = plan.bricks.filter((b) => b.isSupport).length
  const gridTotal = work.size[0] * work.size[1] * work.size[2]
  const saving = 1 - plan.bricks.length / gridTotal
  assert(saving >= 0.25, `相对全实心省料 ≥25%（实测 ${(saving * 100).toFixed(1)}%）`)
  console.log(
    `  砖数=${plan.bricks.length}（其中支撑 ${supportCount}）步骤=${plan.steps.length} 问题=${plan.issues.length} 合砖=${plan.elapsedMs.toFixed(1)}ms`,
  )
}

const runCase = (
  name: string,
  mesh: ReturnType<typeof createSampleCat>,
  resolution: number,
): void => {
  console.log(`\n=== ${name}（分辨率 ${resolution}）===`)
  const t0 = performance.now()
  const vol = voxelizeCpu(mesh, { resolution, shellThickness: 2, voxelMm: 8 })
  const voxelMs = performance.now() - t0
  console.log(
    `体素: 尺寸=${vol.size.join('x')} 实心=${vol.stats.total} 掏空=${vol.stats.hollowed} 耗时=${voxelMs.toFixed(1)}ms`,
  )
  assert(vol.stats.total > 0, '产出实心体素')
  assert(vol.stats.hollowed > 0, '内部掏空生效')

  const quant = quantizeColors(vol, new Map(), true)
  assert(quant.usage.size > 0, '配色量化产出色卡用量')
  assert(solidCellsAllColored(vol), '所有实心格均已配色')

  verifyStructure(vol, name)
}

const main = (): void => {
  runCase('坐猫', createSampleCat(), 64)
  runCase('小房子', createSampleHouse(), 80)

  console.log('\n=== 性能红线（目标合计 ≤ 10s）===')
  const t0 = performance.now()
  const big = voxelizeCpu(createSampleCat(), { resolution: 140, shellThickness: 2, voxelMm: 8 })
  quantizeColors(big, new Map(), true)
  const plan = mergeBricks(big, makeSettings(140))
  const total = performance.now() - t0
  console.log(
    `实心=${big.stats.total} 全链路=${total.toFixed(0)}ms（其中合砖 ${plan.elapsedMs.toFixed(0)}ms）`,
  )
  assert(total <= 10000, `十万级体素全链路 ≤10s（实测 ${total.toFixed(0)}ms）`)

  console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
