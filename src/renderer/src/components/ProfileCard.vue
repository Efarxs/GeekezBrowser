<template>
    <div class="profile-item no-drag" :class="{ 'has-frame-color': !!frameColor }" :style="frameColorStyle">
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
                <span v-if="preProxyTag" class="tag" style="border:1px solid var(--accent); color: var(--accent);">{{ preProxyTag }}</span>
                <span
                    v-if="showDebugPort"
                    class="debug-port-chip no-drag"
                    :class="{ live: isRunning, idle: !isRunning }"
                    :title="debugPortTitle"
                    @click.stop="copyDebugUrl"
                >
                    <span class="debug-port-dot"></span>
                    :{{ profile.debugPort }}
                    <span v-if="debugCopiedFlash" class="debug-copied">✓</span>
                </span>
            </div>
            <div v-if="launchProgress" class="inline-launch-progress" :title="launchProgress.message">
                <div class="inline-launch-progress-bar">
                    <div class="inline-launch-progress-fill" :style="{ width: launchProgress.percent + '%' }"></div>
                </div>
                <div class="inline-launch-progress-meta">
                    <span class="inline-launch-progress-msg">{{ launchProgress.message }}</span>
                    <span class="inline-launch-progress-pct">{{ launchProgress.percent }}%</span>
                </div>
            </div>
            <div v-if="launchError"
                class="inline-launch-error"
                :title="t('inlineLaunchErrorViewHint')"
                @click="handleErrorClick">
                <span class="inline-launch-error-icon">⚠</span>
                <span class="inline-launch-error-msg">{{ launchError.message }}</span>
                <span class="inline-launch-error-close no-drag" @click.stop="dismissError">✕</span>
            </div>
        </div>
        <div class="actions">
            <div class="launch-group no-drag">
                <button v-if="isRunning" class="no-drag stop-btn" @click="stop" :disabled="stopping">{{ stopping ? t('stoppingStatus') : t('stop') }}</button>
                <button v-else class="no-drag" @click="launch" :disabled="isLaunching">{{ isLaunching ? t('launchingStatus') : t('launch') }}</button>
                <button
                    v-if="!isRunning"
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
                <div class="launch-menu-item" @click="runFingerprintCheck">{{ t('fingerprintCheck') }}</div>
                <div class="launch-menu-divider"></div>
                <div class="launch-menu-item" @click="duplicateProfile">{{ t('duplicateProfile') }}</div>
                <div class="launch-menu-divider"></div>
                <div class="launch-menu-item" @click="importCookiesFromFile">{{ t('cookieImport') }}</div>
                <div class="launch-menu-item launch-menu-item-has-sub" @click.stop="toggleExportSub">
                    <span>{{ t('cookieExport') }}</span>
                    <span class="launch-menu-caret">{{ showExportSub ? '▾' : '▸' }}</span>
                    <div v-show="showExportSub" class="launch-menu-sub" @click.stop>
                        <div class="launch-menu-item" @click="exportCookiesAs('netscape')">Netscape (.txt)</div>
                        <div class="launch-menu-item" @click="exportCookiesAs('json')">Playwright JSON</div>
                        <div class="launch-menu-item" @click="exportCookiesAs('editthiscookie')">EditThisCookie</div>
                    </div>
                </div>
            </div>
        </template>
    </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, nextTick } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { useProfileStore } from '../store/useProfileStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { profileService } from '../services/profile.service';
import { getProxyProtocol } from '../utils/helpers';

const uiStore = useUIStore();
const profileStore = useProfileStore();
const settingsStore = useSettingsStore();

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
    const main = getProxyProtocol(props.profile.proxyStr);
    if (main !== 'N/A') return main;
    // No main proxy. A dedicated pre-proxy (unless force-off) becomes the
    // actual exit, so the connection isn't "direct" — show its protocol.
    // Only a truly empty setup is DIRECT.
    const override = props.profile.preProxyOverride || 'default';
    const pre = (props.profile.preProxyStr || '').trim();
    if (override !== 'off' && pre) return getProxyProtocol(pre);
    return 'DIRECT';
});

// Read-only pre-proxy status tag (editing moved to the profile editor). Shown
// only when it's not the default "follow global" to keep cards uncluttered.
const preProxyTag = computed(() => {
    const override = props.profile.preProxyOverride || 'default';
    const pre = (props.profile.preProxyStr || '').trim();
    if (override === 'off') return t('preProxyTagOff');
    if (pre) return t('preProxyTagDedicated');
    if (override === 'on') return t('preProxyTagPool');
    return null; // default → no tag
});

const displayScreen = computed(() => {
    const screen = props.profile.fingerprint?.screen;
    if (screen && screen.width && screen.height) {
        return `${screen.width}x${screen.height}`;
    }
    return '0x0';
});

const launchProgress = computed(() => profileStore.getLaunchProgress(props.profile.id));
const launchError = computed(() => profileStore.getLaunchError(props.profile.id));

// Per-launch window frame color (watermark-off). Tints the card border to
// match the browser window frame so instances are easy to pair up.
const frameColor = computed(() => (props.isRunning ? profileStore.getFrameColor(props.profile.id) : null));
const frameColorStyle = computed(() => frameColor.value
    ? { borderColor: frameColor.value, boxShadow: `0 0 0 1px ${frameColor.value}, 0 0 14px -4px ${frameColor.value}` }
    : {});

const dismissError = () => profileStore.clearLaunchError(props.profile.id);

// Clicking the inline banner opens the dedicated launch-error modal
// (fuller view of the message + stderr tail, monospace, scrollable).
// When the user closes the modal we also clear the inline banner —
// they've acknowledged the error, no need to leave it lingering. The
// ✕ on the banner still fires dismissError directly for a quick
// discard without opening the modal.
const handleErrorClick = () => {
    const err = launchError.value;
    if (!err) return;
    uiStore.showLaunchError({
        message: err.message || '',
        stderr: err.stderrTail || '',
        profileName: props.profile.name || props.profile.id,
        onClose: () => profileStore.clearLaunchError(props.profile.id)
    });
};

const showDebugPort = computed(() => !!(
    settingsStore.enableRemoteDebugging && props.profile.debugPort
));
const debugPortTitle = computed(() => {
    const url = `http://127.0.0.1:${props.profile.debugPort}`;
    const state = props.isRunning ? t('debugPortLive') : t('debugPortIdle');
    return `${state}\n${url}\n${t('debugPortClickHint')}`;
});

const debugCopiedFlash = ref(false);
const copyDebugUrl = async () => {
    const url = `http://127.0.0.1:${props.profile.debugPort}`;
    try {
        await navigator.clipboard.writeText(url);
    } catch (e) {
        // Fallback for restricted contexts
        try {
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (err) { }
    }
    debugCopiedFlash.value = true;
    setTimeout(() => { debugCopiedFlash.value = false; }, 1200);
};

const toggleSelected = () => {
    profileStore.toggleSelected(props.profile.id);
};

const showLaunchMenu = ref(false);
const launchMoreBtn = ref(null);
const launchMenuEl = ref(null);
const launchMenuStyle = ref({});
// Cookie-export used to be a sideways flyout (left:100%), which overflowed the
// window in list view (full-width cards → menu at right edge → nowhere to fly).
// Now it's an inline accordion that expands downward — no horizontal space
// needed, works identically in grid and list views.
const showExportSub = ref(false);
const toggleExportSub = () => {
    showExportSub.value = !showExportSub.value;
    // Expanding grows the menu taller — reposition so it doesn't run off-screen.
    nextTick(() => positionLaunchMenu());
};

const positionLaunchMenu = () => {
    const el = launchMoreBtn.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 200;
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth));

    // The menu is position:fixed teleported to <body>, so it isn't clipped by
    // overflow — but it CAN run off the bottom of the window (cards near the
    // page bottom) and become unreachable. Measure the rendered menu and flip
    // it above the button when there isn't room below; clamp to the viewport
    // as a last resort (its own max-height lets it scroll internally).
    const menuEl = launchMenuEl.value;
    const menuHeight = menuEl ? menuEl.offsetHeight : 0;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    let top;
    if (menuHeight && menuHeight > spaceBelow && spaceAbove > spaceBelow) {
        // Not enough room below and more room above → anchor above the button.
        top = Math.max(margin, rect.top - menuHeight - 4);
    } else {
        top = rect.bottom + 4;
        if (menuHeight) top = Math.min(top, Math.max(margin, window.innerHeight - menuHeight - margin));
    }
    launchMenuStyle.value = {
        top: `${top}px`,
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
    showExportSub.value = false;
    detachGlobalListeners();
}

const toggleLaunchMenu = () => {
    if (props.isLaunching) return;
    if (showLaunchMenu.value) {
        closeLaunchMenu();
        return;
    }
    // Pre-position with a rough estimate, render, then reposition once we can
    // measure the real menu height (needed for the flip-above logic).
    positionLaunchMenu();
    showLaunchMenu.value = true;
    attachGlobalListeners();
    nextTick(() => positionLaunchMenu());
};

onBeforeUnmount(detachGlobalListeners);

const launch = async () => {
    if (props.isLaunching) return;
    closeLaunchMenu();
    profileStore.clearLaunchError(props.profile.id);
    const res = await profileService.launch(props.profile.id);
    if (!res.success && res.message) {
        profileStore.setLaunchError(props.profile.id, {
            message: res.message,
            kind: 'launch-failed'
        });
    }
};

const stopping = ref(false);
const stop = async () => {
    if (stopping.value) return;
    stopping.value = true;
    try {
        const res = await profileService.stop(props.profile.id);
        // On success the main process broadcasts 'profile-status':stopped,
        // which App.vue uses to drop the id from runningIds — the button then
        // flips back to Launch on its own. Surface only real failures.
        if (res && res.success === false && res.error && res.error !== 'Profile not running') {
            uiStore.showAlert((t('stopFailed') || 'Stop failed') + ': ' + res.error);
        }
    } finally {
        stopping.value = false;
    }
};

const launchClean = async () => {
    if (props.isLaunching) return;
    closeLaunchMenu();
    profileStore.clearLaunchError(props.profile.id);
    const res = await profileService.launch(props.profile.id, { useCleanProfile: true });
    if (!res.success && res.message) {
        profileStore.setLaunchError(props.profile.id, {
            message: res.message,
            kind: 'launch-failed'
        });
    }
};

const exportCookiesAs = async (format) => {
    closeLaunchMenu();
    if (props.isRunning || props.isLaunching) {
        uiStore.showAlert(t('mustStopFirst') || 'Please stop the profile first');
        return;
    }
    try {
        const res = await window.electronAPI.exportCookies(props.profile.id, format);
        if (res?.canceled) return;
        if (!res?.success) {
            uiStore.showAlert('Export failed: ' + (res?.message || 'unknown'));
            return;
        }
        uiStore.showAlert(`Exported ${res.count} cookies to ${res.path}`);
    } catch (e) {
        uiStore.showAlert('Export failed: ' + (e?.message || e));
    }
};

const importCookiesFromFile = async () => {
    closeLaunchMenu();
    if (props.isRunning || props.isLaunching) {
        uiStore.showAlert(t('mustStopFirst') || 'Please stop the profile first');
        return;
    }
    try {
        const res = await window.electronAPI.importCookies(props.profile.id, null);
        if (res?.canceled) return;
        if (!res?.success) {
            uiStore.showAlert('Import failed: ' + (res?.message || 'unknown'));
            return;
        }
        uiStore.showAlert(`Imported ${res.count}/${res.total} cookies`);
    } catch (e) {
        uiStore.showAlert('Import failed: ' + (e?.message || e));
    }
};

const runFingerprintCheck = async () => {
    closeLaunchMenu();
    profileStore.clearLaunchError(props.profile.id);
    try {
        const res = await profileService.launch(props.profile.id, {
            initialUrl: 'https://www.browserscan.net/'
        });
        if (!res.success && res.message) {
            profileStore.setLaunchError(props.profile.id, {
                message: res.message,
                kind: 'launch-failed'
            });
        }
    } catch (e) {
        profileStore.setLaunchError(props.profile.id, {
            message: 'Check failed: ' + (e?.message || e),
            kind: 'launch-failed'
        });
    }
};

const edit = () => {
    // Running/launching profiles open in view-only mode (handled inside the modal).
    uiStore.openEditModal(props.profile.id);
};

// Duplicate this profile. Login-state copy (in the modal) requires the source
// to be stopped, so the entry lives in the launch-more menu (hidden while
// running). The modal handles the fingerprint-identical vs fresh-seed choice.
const duplicateProfile = () => {
    closeLaunchMenu();
    uiStore.openDuplicateModal(props.profile);
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

.debug-port-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-family: 'JetBrains Mono', Consolas, ui-monospace, monospace;
    letter-spacing: 0.3px;
    cursor: pointer;
    user-select: none;
    transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.debug-port-chip.live {
    background: rgba(76, 175, 80, 0.15);
    color: #7fd48a;
    border: 1px solid rgba(76, 175, 80, 0.55);
}
.debug-port-chip.idle {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-secondary, #888);
    border: 1px dashed rgba(255, 255, 255, 0.18);
}
.debug-port-chip:hover {
    transform: translateY(-1px);
}
.debug-port-chip.live:hover {
    background: rgba(76, 175, 80, 0.25);
}
.debug-port-chip.idle:hover {
    background: rgba(255, 255, 255, 0.08);
}
.debug-port-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.85;
}
.debug-port-chip.live .debug-port-dot {
    animation: debug-port-pulse 1.6s ease-in-out infinite;
}
@keyframes debug-port-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
}
.debug-copied {
    margin-left: 2px;
    font-weight: 600;
}

.inline-launch-progress {
    margin-top: 8px;
    width: 100%;
    max-width: 520px;
}
.inline-launch-progress-bar {
    height: 4px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid var(--border);
    overflow: hidden;
}
.inline-launch-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #00bcd4, var(--accent), #6ee7f9);
    transition: width 0.25s ease;
}
.inline-launch-progress-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-secondary);
}
.inline-launch-progress-msg {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.inline-launch-progress-pct {
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
}

.inline-launch-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(231, 76, 60, 0.10);
    border: 1px solid rgba(231, 76, 60, 0.35);
    color: #f5a89f;
    font-size: 11px;
    line-height: 1.4;
    max-width: 520px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
}
.inline-launch-error:hover {
    background: rgba(231, 76, 60, 0.16);
}
.inline-launch-error-icon {
    flex-shrink: 0;
    color: #e74c3c;
    font-size: 12px;
}
.inline-launch-error-msg {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.inline-launch-error-close {
    flex-shrink: 0;
    color: #f5a89f;
    opacity: 0.6;
    font-size: 12px;
    padding: 0 2px;
    cursor: pointer;
}
.inline-launch-error-close:hover {
    opacity: 1;
}

.launch-group {
    position: relative;
    display: inline-flex;
}
.launch-group > button:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}
.launch-group > button.stop-btn {
    background: var(--danger, #ff3b30);
    border-color: var(--danger, #ff3b30);
    color: #fff;
}
.launch-group > button.stop-btn:hover:not(:disabled) {
    filter: brightness(1.08);
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
    /* Safe to scroll now that the cookie-export submenu is an inline accordion
       (no sideways left:100% child that overflow-x:clip would cut off). */
    max-height: calc(100vh - 16px);
    overflow-y: auto;
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
.launch-menu-floating .launch-menu-divider {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.08));
    margin: 4px 0;
}
/* Cookie-export is an inline downward accordion (not a sideways flyout), so it
   needs no horizontal room and behaves identically in grid + list views. */
.launch-menu-floating .launch-menu-item-has-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.launch-menu-floating .launch-menu-caret {
    opacity: 0.6;
    font-size: 11px;
}
.launch-menu-floating .launch-menu-sub {
    /* Full-width child; break out of the parent's flex row and stack below. */
    flex-basis: 100%;
    margin: 4px -14px -4px;
    padding: 4px 0;
    border-top: 1px solid var(--border, rgba(255,255,255,0.08));
    background: rgba(0, 0, 0, 0.18);
}
.launch-menu-floating .launch-menu-sub .launch-menu-item {
    padding-left: 28px;
}
</style>
