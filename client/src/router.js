import { createRouter, createWebHistory } from 'vue-router';
import { isLoggedIn } from './stores/auth.js';

const routes = [
  { path: '/login', component: () => import('./views/LoginView.vue') },
  { path: '/register', component: () => import('./views/RegisterView.vue') },
  { path: '/', component: () => import('./views/ChatView.vue'), meta: { requiresAuth: true } },
  { path: '/profile', component: () => import('./views/ProfileView.vue'), meta: { requiresAuth: true } },
  { path: '/admin', component: () => import('./views/AdminView.vue') }
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isLoggedIn()) return '/login';
  if ((to.path === '/login' || to.path === '/register') && isLoggedIn()) return '/';
  return true;
});

export default router;
