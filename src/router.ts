import { createRouter, createWebHashHistory } from 'vue-router'

import AppLayout from './components/app_layout.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      redirect: '/orders',
      children: [
        { path: 'orders', name: 'orders', component: () => import('./pages/orders_page.vue') },
        { path: 'import', name: 'import', component: () => import('./pages/import_page.vue') },
        { path: 'voxelize', name: 'voxelize', component: () => import('./pages/voxelize_page.vue') },
        { path: 'color', name: 'color', component: () => import('./pages/color_page.vue') },
        { path: 'plan', name: 'plan', component: () => import('./pages/plan_page.vue') },
        { path: 'settings', name: 'settings', component: () => import('./pages/settings_page.vue') },
      ],
    },
  ],
})
