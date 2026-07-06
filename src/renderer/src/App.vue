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
    <InputModal :class="{ active: uiStore.inputModalVisible }" />
    <ProgressModal :class="{ active: uiStore.progressModalVisible }" />
    


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
import SettingsModal from './components/SettingsModal.vue';
import HelpModal from './components/HelpModal.vue';
import InputModal from './components/InputModal.vue';
import ProgressModal from './components/ProgressModal.vue';
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
        profileService.onStatusChange(({ id, status }) => {
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
                    return;
                }

                if (status === 'stopped') {
                    if (runningIdx !== -1) window.profileStore.runningIds.splice(runningIdx, 1);
                    if (launchingIdx !== -1) window.profileStore.launchingIds.splice(launchingIdx, 1);
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
            if (!payload) return;
            const lang = localStorage.getItem('geekez_lang') === 'en' ? 'en' : 'cn';
            const heading = lang === 'en'
                ? `Environment "${payload.profileName || payload.profileId}" stopped unexpectedly`
                : `环境「${payload.profileName || payload.profileId}」异常退出`;
            const parts = [heading];
            if (payload.reason) parts.push(payload.reason);
            let tail = (payload.stderrTail || '').trim();
            if (tail.length > 600) tail = '...' + tail.slice(-600);
            if (tail) {
                parts.push(lang === 'en' ? 'Last output:' : '最后输出：');
                parts.push(tail);
            }
            uiStore.showAlert(parts.join('\n\n'));
        });

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
