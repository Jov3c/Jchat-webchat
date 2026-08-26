import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { restoreKeys } from './stores/keys.js';
import './styles/tokens.css';
import './styles/base.css';

// 先恢复端到端加密私钥（从 sessionStorage），再挂载应用，避免刷新后“密钥未就绪”
restoreKeys().finally(() => {
  createApp(App).use(router).mount('#app');
});
