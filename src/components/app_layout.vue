<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  Boxes,
  Clapperboard,
  Cuboid,
  Palette,
  Settings,
  Upload,
} from 'lucide-vue-next'

import { useOrderStore } from '../stores/order_store'

const orderStore = useOrderStore()
const route = useRoute()

const nav = [
  { to: '/orders', label: '订单列表', icon: Boxes },
  { to: '/import', label: '模型导入', icon: Upload },
  { to: '/voxelize', label: '体素化', icon: Cuboid },
  { to: '/color', label: '配色', icon: Palette },
  { to: '/plan', label: '搭建图纸', icon: Clapperboard },
  { to: '/settings', label: '设置', icon: Settings },
]

const statusLabel: Record<string, string> = {
  pending: '待处理',
  modeling: '已导入',
  voxel: '已体素化',
  colored: '已配色',
  planned: '已出图',
  done: '已完成',
}

const currentName = computed(() => orderStore.current?.name ?? '未选择订单')
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">砖</span>
        <div>
          <h1 class="brand-title">砖造工坊</h1>
          <p class="brand-sub">颗粒积木定制系统</p>
        </div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path.startsWith(item.to) }"
        >
          <component :is="item.icon" :size="18" :stroke-width="1.7" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <p class="foot-label">当前订单</p>
        <p class="foot-name">{{ currentName }}</p>
        <span v-if="orderStore.current" class="chip">
          {{ statusLabel[orderStore.current.status] }}
        </span>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 232px 1fr;
  height: 100%;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  padding: var(--sp-5) var(--sp-4);
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
  background: var(--c-primary);
  color: #fff;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
}

.brand-title {
  font-size: var(--fs-lg);
}

.brand-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-3);
  border-radius: var(--radius-sm);
  color: var(--c-text-2);
  text-decoration: none;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  transition:
    background var(--t-fast),
    color var(--t-fast);
}

.nav-item:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}

.nav-item.active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.sidebar-foot {
  margin-top: auto;
  padding: var(--sp-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.foot-label {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.foot-name {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.main {
  padding: var(--sp-6);
  overflow: auto;
}
</style>
