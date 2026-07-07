<template>
    <div class="kernel-panel">
        <h3 class="kernel-panel-title">{{ t('kernelPanelTitle') }}</h3>
        <p class="kernel-panel-desc">{{ t('kernelPanelDesc') }}</p>

        <div class="kernel-panel-section">
            <div class="kernel-panel-section-head">
                <span class="kernel-panel-section-title">{{ t('kernelPanelInstalledHeader') }}</span>
                <button class="link-btn" @click="refreshAll" :disabled="loading">
                    {{ loading ? '…' : t('kernelPanelRefresh') }}
                </button>
            </div>

            <div v-if="installed.length === 0" class="kernel-panel-empty">
                {{ t('kernelPanelNoneInstalled') }}
            </div>
            <div v-else class="kernel-panel-list">
                <div v-for="k in installed" :key="k.version" class="kernel-row">
                    <div class="kernel-row-main">
                        <div class="kernel-version">
                            {{ k.version }}
                            <span v-if="k.version === pinned" class="kernel-badge">
                                {{ t('kernelPanelPinnedBadge') }}
                            </span>
                        </div>
                        <div class="kernel-meta">
                            <span>{{ t('kernelPanelSize') }}: {{ fmtBytes(k.size) }}</span>
                            <span v-if="k.installedAt">·</span>
                            <span v-if="k.installedAt">{{ t('kernelPanelInstalledAt') }}: {{ fmtDate(k.installedAt) }}</span>
                        </div>
                    </div>
                    <button
                        class="danger outline"
                        :disabled="k.version === pinned || busyVersion === k.version"
                        @click="askUninstall(k.version)"
                    >
                        {{ t('kernelPanelActionUninstall') }}
                    </button>
                </div>
            </div>
        </div>

        <div class="kernel-panel-section">
            <div class="kernel-panel-section-head">
                <span class="kernel-panel-section-title">{{ t('kernelPanelAvailableHeader') }}</span>
                <span class="kernel-panel-upstream">{{ t('kernelPanelUpstream') }}: adryfish/fingerprint-chromium</span>
            </div>

            <div v-if="uninstalledAvailable.length === 0" class="kernel-panel-empty">
                —
            </div>
            <div v-else class="kernel-panel-list">
                <div v-for="a in uninstalledAvailable" :key="a.version" class="kernel-row">
                    <div class="kernel-row-main">
                        <div class="kernel-version">{{ a.version }}</div>
                        <div class="kernel-meta">
                            <span>{{ t('kernelPanelSize') }}: ~{{ fmtBytes(a.assetSize) }}</span>
                            <span v-if="a.publishedAt">·</span>
                            <span v-if="a.publishedAt">{{ t('kernelPanelPublished') }}: {{ fmtDate(a.publishedAt) }}</span>
                        </div>
                    </div>
                    <button
                        :disabled="busyVersion === a.version || !!busyVersion"
                        @click="install(a.version)"
                    >
                        {{ busyVersion === a.version ? '…' : t('kernelPanelActionInstall') }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useUIStore } from '../store/useUIStore';

const uiStore = useUIStore();
const t = (key) => (window.t ? window.t(key) : key);

const installed = ref([]);
const available = ref([]);
const pinned = ref('');
const loading = ref(false);
const busyVersion = ref('');

const installedSet = computed(() => new Set(installed.value.map(k => k.version)));
const uninstalledAvailable = computed(() =>
    available.value.filter(a => !installedSet.value.has(a.version)).slice(0, 10)
);

async function refreshAll() {
    loading.value = true;
    try {
        const [inst, avail] = await Promise.all([
            window.electronAPI?.listInstalledKernels?.() || Promise.resolve({ ok: false }),
            window.electronAPI?.listAvailableKernels?.() || Promise.resolve({ ok: false })
        ]);
        if (inst?.ok) {
            pinned.value = inst.pinned || '';
            installed.value = await hydrateSizes(inst.installed || []);
        }
        if (avail?.ok) {
            available.value = avail.available || [];
        }
    } catch (e) {
        console.warn('[KernelPanel] refresh failed:', e);
    } finally {
        loading.value = false;
    }
}

// The main-process list-installed handler doesn't need to walk each
// version's tree to compute size — do it here (cheaper if the app has
// many kernels, since we only render a handful).
async function hydrateSizes(list) {
    // No IPC channel exists yet for du-style measurement, so fall back
    // to a fixed estimate. Real byte size is a future enhancement.
    return list.map(k => ({ ...k, size: k.size || 425 * 1024 * 1024 }));
}

async function install(version) {
    if (busyVersion.value) return;
    busyVersion.value = version;
    // Surface progress via the shared kernel modal (main sends
    // kernel:progress events; App.vue already binds them to uiStore).
    uiStore.kernelVersion = version;
    uiStore.kernelPhase = 'idle';
    uiStore.kernelPercent = 0;
    uiStore.kernelError = '';
    uiStore.kernelModalVisible = true;
    try {
        const result = await window.electronAPI.installKernelVersion(version);
        if (!result?.ok) {
            uiStore.kernelPhase = 'error';
            uiStore.kernelError = result?.error || 'install failed';
        }
        await refreshAll();
    } catch (e) {
        uiStore.kernelPhase = 'error';
        uiStore.kernelError = e?.message || String(e);
    } finally {
        busyVersion.value = '';
    }
}

function askUninstall(version) {
    if (version === pinned.value) return;
    uiStore.showConfirm(t('kernelPanelUninstallConfirm'), () => uninstall(version));
}

async function uninstall(version) {
    busyVersion.value = version;
    try {
        await window.electronAPI.uninstallKernelVersion(version);
        await refreshAll();
    } catch (e) {
        console.warn('[KernelPanel] uninstall failed:', e);
    } finally {
        busyVersion.value = '';
    }
}

function fmtBytes(n) {
    n = Number(n) || 0;
    if (n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDate(v) {
    if (!v) return '';
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
}

onMounted(refreshAll);
</script>

<style scoped>
.kernel-panel { padding: 6px 4px; }
.kernel-panel-title {
    margin: 0 0 8px;
    color: var(--accent);
}
.kernel-panel-desc {
    font-size: 12px;
    opacity: 0.7;
    margin: 0 0 18px;
}
.kernel-panel-section { margin-bottom: 22px; }
.kernel-panel-section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
}
.kernel-panel-section-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-secondary);
}
.kernel-panel-upstream {
    font-size: 11px;
    opacity: 0.55;
}
.link-btn {
    background: transparent;
    border: 0;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
}
.link-btn:hover { text-decoration: underline; }
.link-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.kernel-panel-empty {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    opacity: 0.55;
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: 8px;
}
.kernel-panel-list { display: flex; flex-direction: column; gap: 8px; }
.kernel-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.1);
}
.kernel-row-main { min-width: 0; flex: 1; }
.kernel-version {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}
.kernel-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(0, 224, 255, 0.15);
    color: var(--accent);
    border: 1px solid rgba(0, 224, 255, 0.3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.kernel-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 4px;
    flex-wrap: wrap;
}
button.danger { color: #ff9a9a; border-color: rgba(255, 90, 95, 0.35); }
button.danger:hover:not(:disabled) { background: rgba(255, 90, 95, 0.12); }
</style>
