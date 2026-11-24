import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  nextId: number
}

export const useToastStore = defineStore('toast', {
  state: (): ToastState => ({ toasts: [], nextId: 1 }),

  actions: {
    push(message: string, kind: ToastKind = 'info'): void {
      const id = this.nextId++
      this.toasts.push({ id, kind, message })
      window.setTimeout(() => this.dismiss(id), 3600)
    },
    success(message: string): void {
      this.push(message, 'success')
    },
    error(message: string): void {
      this.push(message, 'error')
    },
    dismiss(id: number): void {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
  },
})
