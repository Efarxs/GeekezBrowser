<template>

    <div id="splash" v-if="showSplash" :class="{ 'fade-out': isFadingOut }">
        <div class="glitch-wrapper">
            <div class="glitch-text" data-text="GeekEZ">GeekEZ</div>
        </div>
    </div>

    <Header />

    <Toolbar />

    <ProfileList />

    <!-- Modals (Controlled by uiStore) -->
    <CreateProfileModal :class="{ active: uiStore.addModalVisible }" />
    <EditProfileModal :class="{ active: uiStore.editModalVisible }" />

    <!-- Other Modals (Legacy wrapper components) -->
    <ProxyModal />
    <SettingsModal :class="{ active: uiStore.settingsModalVisible }" />
    <HelpModal :class="{ active: uiStore.helpModalVisible }" />
    <ExportModal :class="{ active: uiStore.exportModalVisible }" />

    <!-- Modals controlled by uiStore -->
    <ExportSelectModal :class="{ active: uiStore.exportSelectModalVisible }" />
    <PasswordModal :class="{ active: uiStore.passwordModalVisible }" />
    <SubEditModal :class="{ active: uiStore.subEditModalVisible }" />
    <ConfirmModal :class="{ active: uiStore.confirmModalVisible }" />
    <AlertModal :class="{ active: uiStore.alertModalVisible }" />
    <LaunchErrorModal />
    <InputModal :class="{ active: uiStore.inputModalVisible }" />
    <ProgressModal :class="{ active: uiStore.progressModalVisible }" />
    <KernelDownloadModal />
    <DuplicateProfileModal />



</template>

<script setup>
import { onMounted, ref } from 'vue';
import Header from './components/Header.vue';
import Toolbar from './components/Toolbar.vue';
import ProfileList from './components/ProfileList.vue';
import CreateProfileModal from './components/CreateProfileModal.vue';
import EditProfileModal from './components/EditProfileModal.vue';
import ProxyModal from './components/ProxyModal.vue';
import ExportModal from './components/ExportModal.vue';
import ExportSelectModal from './components/ExportSelectModal.vue';
import PasswordModal from './components/PasswordModal.vue';
import SubEditModal from './components/SubEditModal.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import AlertModal from './components/AlertModal.vue';
import LaunchErrorModal from './components/LaunchErrorModal.vue';
import SettingsModal from './components/SettingsModal.vue';
import HelpModal from './components/HelpModal.vue';
import InputModal from './components/InputModal.vue';
import ProgressModal from './components/ProgressModal.vue';
import KernelDownloadModal from './components/KernelDownloadModal.vue';
import DuplicateProfileModal from './components/DuplicateProfileModal.vue';
import { profileService } from './services/profile.service';
import { useUIStore } from './store/useUIStore';
import { useProxyStore } from './store/useProxyStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useProfileStore } from './store/useProfileStore';

const uiStore = useUIStore();
const proxyStore = useProxyStore();
const settingsStore = useSettingsStore();
const profileStore = useProfileStore();

window.uiStore = uiStore; 
window.proxyStore = proxyStore;
window.settingsStore = settingsStore; 
window.profileStore = profileStore;
const showSplash = ref(true);
const isFadingOut = ref(false);

onMounted(async () => {
    console.log('[App] Mounted, starting initialization...');
    
    // 1. 并行启动开屏移除计时器，确保不被 init() 阻塞
    setTimeout(() => {
        console.log('[App] Starting splash fade out...');
        isFadingOut.value = true;
        setTimeout(() => {
            showSplash.value = false;
            console.log('[App] Splash screen removed.');
        }, 500);
    }, 1500);

    // 2. 异步执行初始化
    try {
        console.log('[App] Initializing service listeners...');
        profileService.onStatusChange(({ id, status, color }) => {
            if (window.profileStore) {
                const runningIdx = window.profileStore.runningIds.indexOf(id);
                const launchingIdx = window.profileStore.launchingIds.indexOf(id);

                if (status === 'launching') {
                    if (launchingIdx === -1) window.profileStore.launchingIds.push(id);
                    if (runningIdx !== -1) window.profileStore.runningIds.splice(runningIdx, 1);
                    return;
                }

                if (status === 'running') {
                    if (runningIdx === -1) window.profileStore.runningIds.push(id);
                    if (launchingIdx !== -1) window.profileStore.launchingIds.splice(launchingIdx, 1);
                    if (color) window.profileStore.frameColors[id] = color;
                    return;
                }

                if (status === 'stopped') {
                    if (runningIdx !== -1) window.profileStore.runningIds.splice(runningIdx, 1);
                    if (launchingIdx !== -1) window.profileStore.launchingIds.splice(launchingIdx, 1);
                    delete window.profileStore.frameColors[id];
                }
            }
        });

        profileService.onRefreshProfiles(() => {
            if (window.profileStore) window.profileStore.loadProfiles();
            if (window.proxyStore) window.proxyStore.loadSettings();
        });

        profileService.onApiLaunchProfile(async (id) => {
            try {
                await profileService.launch(id);
            } catch (e) {
                console.error('[App] API launch profile failed:', e);
            }
        });

        profileService.onProfileCrash((payload) => {
            if (!payload || !payload.profileId) return;
            const lang = localStorage.getItem('geekez_lang') === 'en' ? 'en' : 'cn';
            const message = payload.reason
                || (lang === 'en' ? 'Environment stopped unexpectedly' : '环境异常退出');
            profileStore.setLaunchError(payload.profileId, {
                message,
                stderrTail: payload.stderrTail || '',
                kind: payload.kind || 'runtime-crash'
            });
        });

        // Kernel install progress → UI store bindings
        if (window.electronAPI && typeof window.electronAPI.onKernelProgress === 'function') {
            window.electronAPI.onKernelProgress((payload) => {
                if (!payload) return;
                if (payload.version) uiStore.kernelVersion = payload.version;
                if (payload.assetName) uiStore.kernelAssetName = payload.assetName;
                if (payload.phase) uiStore.kernelPhase = payload.phase;
                if (typeof payload.message === 'string') uiStore.kernelMessage = payload.message;
                if (Number.isFinite(payload.bytes)) uiStore.kernelBytes = payload.bytes;
                if (Number.isFinite(payload.total)) uiStore.kernelTotal = payload.total;
                if (Number.isFinite(payload.speedBytesPerSec)) uiStore.kernelSpeed = payload.speedBytesPerSec;
                if (Number.isFinite(payload.etaSec)) uiStore.kernelEta = payload.etaSec;
                if (Array.isArray(payload.chunks)) uiStore.kernelChunks = payload.chunks;
                if (uiStore.kernelTotal > 0 && uiStore.kernelPhase === 'download') {
                    uiStore.kernelPercent = Math.min(100, Math.round((uiStore.kernelBytes / uiStore.kernelTotal) * 100));
                } else if (payload.phase === 'assemble') {
                    uiStore.kernelPercent = Math.max(uiStore.kernelPercent, 93);
                } else if (payload.phase === 'extract') {
                    uiStore.kernelPercent = Math.max(uiStore.kernelPercent, 95);
                } else if (payload.phase === 'verify') {
                    uiStore.kernelPercent = 99;
                } else if (payload.phase === 'done') {
                    uiStore.kernelPercent = 100;
                    setTimeout(() => { uiStore.kernelModalVisible = false; }, 800);
                } else if (payload.phase === 'error') {
                    uiStore.kernelError = payload.message || 'Unknown error';
                }
            });
        }

        // First-run kernel check + install trigger.
        (async () => {
            try {
                if (!window.electronAPI?.getKernelStatus) return;
                const status = await window.electronAPI.getKernelStatus();
                if (status?.installed) return;
                uiStore.kernelVersion = status?.version || '';
                uiStore.kernelPhase = 'idle';
                uiStore.kernelPercent = 0;
                uiStore.kernelModalVisible = true;
                const result = await window.electronAPI.ensureKernel();
                if (!result?.ok) {
                    uiStore.kernelPhase = 'error';
                    uiStore.kernelError = result?.error || 'Kernel install failed';
                }
            } catch (e) {
                uiStore.kernelPhase = 'error';
                uiStore.kernelError = e?.message || String(e);
                uiStore.kernelModalVisible = true;
            }
        })();

        profileService.onLaunchProgress((payload) => {
            if (!payload || !payload.profileId) return;

            const visible = payload.visible !== false;
            if (!visible) {
                profileStore.clearLaunchProgress(payload.profileId);
                return;
            }

            profileStore.setLaunchProgress(payload.profileId, {
                percent: Number.isFinite(payload.percent) ? payload.percent : 0,
                message: payload.message || '...',
                step: Number.isFinite(payload.step) ? payload.step : 0,
                totalSteps: Number.isFinite(payload.totalSteps) ? payload.totalSteps : 0,
                title: payload.title || 'Launching Profile',
                warn: payload.warn || ''
            });
        });
        console.log('[App] Initialization completed.');
    } catch (e) {
        console.error('[App] Initialization failed:', e);
    }

    // 3. 诊断：增加全局点击监听器，帮助定位拦截层
    window.addEventListener('click', (e) => {
        console.log('[Diagnostic] Global Click at:', e.clientX, e.clientY, 'Target:', e.target);
    }, true);
});
</script>
