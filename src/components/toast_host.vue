<script setup lang="ts">
import { CheckCircle2, Info, XCircle } from 'lucide-vue-next'

import { useToastStore } from '../stores/toast_store'

const toastStore = useToastStore()

const iconFor = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
}
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="toast"
        :class="toast.kind"
        @click="toastStore.dismiss(toast.id)"
      >
        <component :is="iconFor[toast.kind]" :size="18" :stroke-width="1.8" />
        <span>{{ toast.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: var(--sp-5);
  right: var(--sp-5);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: var(--fs-xs);
  cursor: pointer;
  min-width: 240px;
}

.toast.success {
  border-left: 3px solid var(--c-success);
}

.toast.error {
  border-left: 3px solid var(--c-danger);
}

.toast.info {
  border-left: 3px solid var(--c-primary);
}

.toast-enter-active,
.toast-leave-active {
  transition: all var(--t);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
