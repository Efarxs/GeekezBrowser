<template>
    <div id="kernelDownloadModal" class="modal-overlay" :class="{ active: uiStore.kernelModalVisible }" style="z-index: 3000;" @mousedown.stop>
        <div class="modal-content kernel-download-modal">
            <div class="kernel-topline">
                <span class="kernel-pulse" :class="{ 'pulse-error': uiStore.kernelPhase === 'error', 'pulse-done': uiStore.kernelPhase === 'done' }"></span>
                <span>{{ phaseLabel }}</span>
            </div>

            <div class="kernel-title">{{ title }}</div>
            <div class="kernel-subtitle" v-if="uiStore.kernelAssetName">{{ uiStore.kernelAssetName }}</div>

            <div class="kernel-bar">
                <div class="kernel-bar-fill" :style="{ width: uiStore.kernelPercent + '%' }"></div>
            </div>

            <div class="kernel-meta">
                <span class="kernel-message">{{ metaLine }}</span>
                <span class="kernel-percent">{{ uiStore.kernelPercent }}%</span>
            </div>

            <div class="kernel-stats" v-if="uiStore.kernelPhase === 'download'">
                <div class="kernel-stat">
                    <span class="stat-label">{{ t('kernelStatDownloaded') }}</span>
                    <span class="stat-value">{{ fmt(uiStore.kernelBytes) }} / {{ fmt(uiStore.kernelTotal) }}</span>
                </div>
                <div class="kernel-stat">
                    <span class="stat-label">{{ t('kernelStatSpeed') }}</span>
                    <span class="stat-value">{{ fmt(uiStore.kernelSpeed) }}/s</span>
                </div>
                <div class="kernel-stat">
                    <span class="stat-label">{{ t('kernelStatEta') }}</span>
                    <span class="stat-value">{{ fmtEta(uiStore.kernelEta) }}</span>
                </div>
            </div>

            <div class="kernel-chunks" v-if="uiStore.kernelChunks && uiStore.kernelChunks.length > 1">
                <div v-for="chunk in uiStore.kernelChunks" :key="chunk.index" class="chunk-slot" :title="`chunk ${chunk.index + 1}`">
                    <div class="chunk-fill" :style="{ width: chunkPct(chunk) + '%' }"></div>
                </div>
            </div>

            <div class="kernel-warn" v-if="uiStore.kernelPhase !== 'error' && uiStore.kernelPhase !== 'done'">
                {{ helpText }}
            </div>

            <div class="kernel-error" v-if="uiStore.kernelPhase === 'error'">
                {{ uiStore.kernelError || t('kernelUnknownError') }}
            </div>

            <div class="kernel-actions">
                <button v-if="uiStore.kernelPhase === 'error'" class="btn-retry" @click="retry">{{ t('kernelBtnRetry') }}</button>
                <button v-if="showCancel" class="btn-cancel" @click="cancel">{{ t('kernelBtnCancel') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUIStore } from '../store/useUIStore';

const uiStore = useUIStore();
const t = (key) => window.t ? window.t(key) : key;

const phaseLabel = computed(() => {
    const map = {
        idle:     'kernelPhasePreparing',
        network:  'kernelPhaseNetwork',
        resolve:  'kernelPhaseResolve',
        download: 'kernelPhaseDownload',
        assemble: 'kernelPhaseAssemble',
        extract:  'kernelPhaseExtract',
        verify:   'kernelPhaseVerify',
        done:     'kernelPhaseDone',
        error:    'kernelPhaseError'
    };
    return t(map[uiStore.kernelPhase] || 'kernelPhasePreparing');
});

const title = computed(() => {
    if (uiStore.kernelPhase === 'done') return t('kernelReadyTitle');
    if (uiStore.kernelPhase === 'error') return t('kernelFailedTitle');
    const base = t('kernelInstallingTitle');
    return uiStore.kernelVersion ? `${base} ${uiStore.kernelVersion}` : base;
});

const helpText = computed(() => {
    if (uiStore.kernelPhase === 'network') return t('kernelHelpNetwork');
    if (uiStore.kernelPhase === 'download') return t('kernelHelpDownload');
    if (uiStore.kernelPhase === 'extract' || uiStore.kernelPhase === 'assemble') return t('kernelHelpExtract');
    return t('kernelHelpDefault');
});

// The meta line above the progress bar. During download, stats section
// already shows numbers — echo the phase label here for narration.
// During other phases fall back to the raw backend message (already
// short technical hints; not user-facing chrome).
const metaLine = computed(() => {
    if (uiStore.kernelPhase === 'download') return phaseLabel.value;
    return uiStore.kernelMessage || phaseLabel.value;
});

const showCancel = computed(() => {
    if (!uiStore.kernelCanCancel) return false;
    return ['network', 'resolve', 'download'].includes(uiStore.kernelPhase);
});

function fmt(n) {
    n = Number(n) || 0;
    if (n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtEta(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec === 0) return '--';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function chunkPct(chunk) {
    if (!chunk || !chunk.total) return 0;
    return Math.min(100, Math.round((chunk.bytes / chunk.total) * 100));
}

async function cancel() {
    try {
        await window.electronAPI.cancelKernelDownload();
    } catch (_) { }
}

async function retry() {
    uiStore.kernelError = '';
    uiStore.kernelPhase = 'idle';
    try {
        await window.electronAPI.ensureKernel();
    } catch (e) {
        uiStore.kernelError = e?.message || String(e);
        uiStore.kernelPhase = 'error';
    }
}
</script>

<style scoped>
.kernel-download-modal {
    width: min(480px, calc(100vw - 32px));
    text-align: center;
    padding: 26px 24px 22px;
    border: 1px solid rgba(0, 224, 255, 0.18);
    background:
        radial-gradient(circle at top, rgba(0, 224, 255, 0.12), transparent 52%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0));
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.kernel-topline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 5px 10px;
    border-radius: 999px;
    color: var(--text-secondary);
    font-size: 11px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.kernel-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f39c12;
    animation: kernelPulse 1.4s ease-in-out infinite;
}
.kernel-pulse.pulse-error {
    background: #ff5a5f;
    animation: none;
}
.kernel-pulse.pulse-done {
    background: #4caf50;
    animation: none;
}

.kernel-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 4px;
}
.kernel-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 14px;
    word-break: break-all;
}

.kernel-bar {
    width: 100%;
    background: rgba(0, 0, 0, 0.22);
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    margin: 0 0 10px;
    border: 1px solid var(--border);
}
.kernel-bar-fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.25s ease;
    background: linear-gradient(90deg, #00bcd4, var(--accent), #6ee7f9);
}

.kernel-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 14px;
    text-align: left;
}
.kernel-message { flex: 1; word-break: break-word; }
.kernel-percent {
    font-weight: 700;
    color: var(--accent);
    white-space: nowrap;
}

.kernel-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    font-size: 11px;
    text-align: left;
    margin-bottom: 12px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
}
.kernel-stat { display: flex; flex-direction: column; gap: 2px; }
.stat-label { color: var(--text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
.stat-value { color: var(--text-primary); font-weight: 600; }

.kernel-chunks {
    display: flex;
    gap: 3px;
    margin-bottom: 12px;
}
.chunk-slot {
    flex: 1;
    height: 4px;
    background: rgba(0, 0, 0, 0.28);
    border-radius: 2px;
    overflow: hidden;
}
.chunk-fill {
    height: 100%;
    background: rgba(0, 224, 255, 0.7);
    transition: width 0.25s ease;
}

.kernel-warn {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.5;
    color: #f7b267;
    background: rgba(243, 156, 18, 0.12);
    border: 1px solid rgba(243, 156, 18, 0.22);
    text-align: left;
}

.kernel-error {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 12px;
    color: #ff9a9a;
    background: rgba(255, 90, 95, 0.12);
    border: 1px solid rgba(255, 90, 95, 0.3);
    text-align: left;
    word-break: break-word;
}

.kernel-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
}
.btn-cancel, .btn-retry {
    padding: 6px 18px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
    transition: background 0.15s;
}
.btn-cancel:hover { background: rgba(255, 90, 95, 0.15); border-color: rgba(255, 90, 95, 0.4); }
.btn-retry { background: rgba(0, 224, 255, 0.12); border-color: rgba(0, 224, 255, 0.35); color: var(--accent); }
.btn-retry:hover { background: rgba(0, 224, 255, 0.22); }

@keyframes kernelPulse {
    0% { transform: scale(0.92); box-shadow: 0 0 0 0 rgba(243, 156, 18, 0.38); }
    70% { transform: scale(1); box-shadow: 0 0 0 9px rgba(243, 156, 18, 0); }
    100% { transform: scale(0.92); box-shadow: 0 0 0 0 rgba(243, 156, 18, 0); }
}
</style>
