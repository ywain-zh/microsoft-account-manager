import { createApp } from 'vue';
import App from './App.vue';
import AppListPanel from './components/AppListPanel.vue';
import AppModal from './components/AppModal.vue';
import { router } from './router';
import './style.css';
import './gradient-system.css';

createApp(App)
  .component('AppListPanel', AppListPanel)
  .component('AppModal', AppModal)
  .use(router)
  .mount('#app');
