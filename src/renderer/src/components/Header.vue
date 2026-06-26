<template>
    <div class="header">
        <div class="logo">
            <svg class="logo-svg" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#00e0ff;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#2980b9;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <path
                    d="M256 100 H 120 A 20 20 0 0 0 100 120 V 392 A 20 20 0 0 0 120 412 H 392 A 20 20 0 0 0 412 392 V 256 H 256 V 320 H 330 V 332 H 180 V 180 H 330 V 100"
                    fill="url(#neon)" />
                <rect x="360" y="80" width="60" height="40" fill="#ff0055" opacity="0.8" />
                <rect x="80" y="280" width="40" height="20" fill="#00e0ff" opacity="0.6" />
                <rect x="400" y="400" width="30" height="30" fill="#00e0ff" />
                <rect x="80" y="80" width="20" height="20" fill="#ff0055" />
            </svg>
            <div class="logo-text">eek<span class="highlight">EZ</span><span class="ver" id="app-version">{{ appVersion }}</span></div>
        </div>
        <div class="top-actions">
            <select class="theme-select" v-model="uiStore.theme" @change="uiStore.setTheme(uiStore.theme)" id="themeSelect">
                <option value="geek">{{ $t('themeGeek') }}</option>
                <option value="light">{{ $t('themeLight') }}</option>
                <option value="dark">{{ $t('themeDark') }}</option>
            </select>
            <div class="icon-btn" @click="openHelp" title="Help"><svg viewBox="0 0 24 24" width="20" height="20"
                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                    <circle cx="12" cy="17" r="0.5" fill="currentColor"></circle>
                </svg></div>
            <div class="icon-btn" @click="openSettings" title="Settings"><svg viewBox="0 0 24 24" width="20"
                    height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path
                        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z">
                    </path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg></div>
            <div class="lang-btn" @click="toggleLang">CN/EN</div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { ipcService } from '../services/ipc.service';

const uiStore = useUIStore();
const appVersion = ref('');

const openHelp = () => {
    uiStore.helpModalVisible = true;
};

const openSettings = () => {
    uiStore.settingsModalVisible = true;
};

const toggleLang = () => {
    uiStore.toggleLang();
};

onMounted(() => {
    document.body.setAttribute('data-theme', uiStore.theme);
    ipcService.getAppInfo()
        .then((info) => {
            if (info && info.version) {
                appVersion.value = `v${info.version}`;
            }
        })
        .catch(() => { });
});
</script>

<style scoped>
/* Scoped styles will be migrated later if needed */
</style>
