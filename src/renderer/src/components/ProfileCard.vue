<template>
    <div class="profile-item no-drag">
        <div class="profile-info">
            <div style="display:flex; align-items:center;">
                <input
                    type="checkbox"
                    class="batch-checkbox no-drag"
                    :checked="isSelected"
                    @change="toggleSelected"
                >
                <h4>{{ profile.name }}</h4>
                <span
                    :id="`status-${profile.id}`"
                    class="running-badge"
                    :class="{ active: isRunning, launching: isLaunching }"
                >
                    {{ isLaunching ? t('launchingStatus') : t('runningStatus') }}
                </span>
            </div>
            <div class="profile-meta">
                <span v-for="tag in profile.tags" :key="tag" class="tag"
                      :style="{ background: stringToColor(tag) + '33', color: stringToColor(tag), border: '1px solid ' + stringToColor(tag) + '44' }">
                    {{ tag }}
                </span>
                <span class="tag">{{ displayProto }}</span>
                <span class="tag">{{ displayScreen }}</span>
                <span class="tag" style="border:1px solid var(--accent);">
                    <select class="quick-switch-select no-drag" :value="profile.preProxyOverride || 'default'" @change="quickUpdatePreProxy($event.target.value)">
                        <option value="default">{{ t('qsDefault') }}</option>
                        <option value="on">{{ t('qsOn') }}</option>
                        <option value="off">{{ t('qsOff') }}</option>
                    </select>
                </span>
            </div>
        </div>
        <div class="actions">
            <div class="launch-group no-drag">
                <button class="no-drag" @click="launch" :disabled="isLaunching">{{ isLaunching ? t('launchingStatus') : t('launch') }}</button>
                <button
                    ref="launchMoreBtn"
                    class="no-drag launch-more"
                    :disabled="isLaunching"
                    :aria-label="t('launchMenu')"
                    @click="toggleLaunchMenu"
                >▾</button>
            </div>
            <button class="outline no-drag" @click="edit">{{ t('edit') }}</button>
            <button class="danger no-drag" @click="remove">{{ t('delete') }}</button>
        </div>
    </div>
    <Teleport to="body">
        <template v-if="showLaunchMenu">
            <div class="launch-menu-backdrop no-drag" @mousedown="closeLaunchMenu"></div>
            <div
                ref="launchMenuEl"
                class="launch-menu launch-menu-floating no-drag"
                :style="launchMenuStyle"
            >
                <div class="launch-menu-item" @click="launchClean">{{ t('launchClean') }}</div>
            </div>
        </template>
    </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { useProfileStore } from '../store/useProfileStore';
import { profileService } from '../services/profile.service';
import { getProxyProtocol } from '../utils/helpers';

const uiStore = useUIStore();
const profileStore = useProfileStore();

const props = defineProps({
    profile: {
        type: Object,
        required: true
    },
    isRunning: {
        type: Boolean,
        default: false
    },
    isLaunching: {
        type: Boolean,
        default: false
    },
    isSelected: {
        type: Boolean,
        default: false
    }
});

const t = (key) => window.t ? window.t(key) : key;

const stringToColor = (str) => {
    if(!str) return '#ffffff';
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
};

const displayProto = computed(() => {
    return getProxyProtocol(props.profile.proxyStr);
});

const displayScreen = computed(() => {
    const screen = props.profile.fingerprint?.screen;
    if (screen && screen.width && screen.height) {
        return `${screen.width}x${screen.height}`;
    }
    return '0x0';
});

const quickUpdatePreProxy = async (val) => {
    if (props.isRunning || props.isLaunching) {
        uiStore.showAlert(t('mustStopFirst'));
        return;
    }
    const p = profileStore.profiles.find(x => x.id === props.profile.id);
    if (p) {
        const previous = p.preProxyOverride || 'default';
        p.preProxyOverride = val;
        const safeProfile = JSON.parse(JSON.stringify(p));
        try {
            await profileStore.updateProfile(safeProfile);
        } catch (e) {
            p.preProxyOverride = previous;
            uiStore.showAlert('保存前置代理设置失败: ' + (e?.message || e));
        }
    }
};

const toggleSelected = () => {
    profileStore.toggleSelected(props.profile.id);
};

const showLaunchMenu = ref(false);
const launchMoreBtn = ref(null);
const launchMenuEl = ref(null);
const launchMenuStyle = ref({});

const positionLaunchMenu = () => {
    const el = launchMoreBtn.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 200;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
    launchMenuStyle.value = {
        top: `${rect.bottom + 4}px`,
        left: `${left}px`,
        minWidth: `${menuWidth}px`
    };
};

const onScrollOrResize = () => {
    if (!showLaunchMenu.value) return;
    positionLaunchMenu();
};
const onKeyDown = (event) => {
    if (event.key === 'Escape') closeLaunchMenu();
};
const onWindowBlur = () => closeLaunchMenu();

const attachGlobalListeners = () => {
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('blur', onWindowBlur);
};
const detachGlobalListeners = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
    window.removeEventListener('blur', onWindowBlur);
};

function closeLaunchMenu() {
    if (!showLaunchMenu.value) return;
    showLaunchMenu.value = false;
    detachGlobalListeners();
}

const toggleLaunchMenu = () => {
    if (props.isLaunching) return;
    if (showLaunchMenu.value) {
        closeLaunchMenu();
        return;
    }
    positionLaunchMenu();
    showLaunchMenu.value = true;
    attachGlobalListeners();
};

onBeforeUnmount(detachGlobalListeners);

const launch = async () => {
    if (props.isLaunching) return;
    closeLaunchMenu();
    const res = await profileService.launch(props.profile.id);
    if (!res.success && res.message) {
        uiStore.showAlert(res.message);
    }
};

const launchClean = async () => {
    if (props.isLaunching) return;
    closeLaunchMenu();
    const res = await profileService.launch(props.profile.id, { useCleanProfile: true });
    if (!res.success && res.message) {
        uiStore.showAlert(res.message);
    }
};

const edit = () => {
    if (props.isRunning || props.isLaunching) {
        uiStore.showAlert(t('runningNoEdit'));
        return;
    }
    uiStore.openEditModal(props.profile.id);
};

const remove = () => {
    if (props.isRunning || props.isLaunching) {
        uiStore.showAlert(t('runningNoDelete'));
        return;
    }
    const msg = window.t('confirmDel') || 'Confirm delete?';
    uiStore.showConfirm(msg, async () => {
        await profileStore.deleteProfile(props.profile.id);
    });
};
</script>

<style scoped>
.batch-checkbox {
    width: 14px;
    height: 14px;
    margin-right: 8px;
    margin-bottom: 0;
}

:deep(.running-badge.launching) {
    color: #f39c12;
    border-color: rgba(243, 156, 18, 0.6);
    background: rgba(243, 156, 18, 0.12);
}

.launch-group {
    position: relative;
    display: inline-flex;
}
.launch-group > button:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}
.launch-more {
    padding: 0 8px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    margin-left: -1px;
}
.launch-menu-item {
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
}
.launch-menu-item:hover {
    background: var(--accent, #4285f4);
    color: #fff;
}
</style>

<style>
.launch-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: transparent;
    -webkit-app-region: no-drag;
}
.launch-menu-floating {
    position: fixed;
    background: var(--card-bg, #22222c);
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    z-index: 10000;
    padding: 4px 0;
    color: var(--text-primary, #e0e0e0);
    -webkit-app-region: no-drag;
}
.launch-menu-floating .launch-menu-item {
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
}
.launch-menu-floating .launch-menu-item:hover {
    background: var(--accent, #4285f4);
    color: #fff;
}
</style>
