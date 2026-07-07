<template>
    <div
        v-if="uiStore.launchErrorModalVisible"
        id="launchErrorModal"
        class="modal-overlay active"
        style="z-index: 3000;"
        @mousedown.self="close"
    >
        <div class="modal-content launch-error-modal">
            <div class="modal-header">
                <span>
                    <span class="err-icon">⚠</span>
                    {{ $t('launchErrorTitle') || 'Browser launch failed' }}
                    <span v-if="uiStore.launchErrorProfileName" class="err-profile">
                        — {{ uiStore.launchErrorProfileName }}
                    </span>
                </span>
                <span style="cursor:pointer" @click="close">✕</span>
            </div>
            <div class="modal-body">
                <div v-if="uiStore.launchErrorMessage" class="err-message">
                    {{ uiStore.launchErrorMessage }}
                </div>
                <div v-if="uiStore.launchErrorStderr" class="err-stderr-block">
                    <div class="err-stderr-label">{{ $t('launchErrorLastOutput') || 'Last output' }}</div>
                    <pre class="err-stderr-body">{{ uiStore.launchErrorStderr }}</pre>
                </div>
            </div>
            <div class="modal-footer">
                <button
                    v-if="uiStore.launchErrorMessage || uiStore.launchErrorStderr"
                    class="outline"
                    @click="copyAll"
                >{{ copyLabel }}</button>
                <button class="primary" @click="close">{{ $t('close') || 'Close' }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { useUIStore } from '../store/useUIStore';

const uiStore = useUIStore();

const copiedFlash = ref(false);
const copyLabel = ref('');
// Reuse existing 'copy' i18n key if present; fall back to "Copy".
const baseCopyLabel = () => (window.t && window.t('copyBtn')) || (window.t && window.t('copy')) || 'Copy';
copyLabel.value = baseCopyLabel();

async function copyAll() {
    const parts = [];
    if (uiStore.launchErrorProfileName) parts.push(`Profile: ${uiStore.launchErrorProfileName}`);
    if (uiStore.launchErrorMessage) parts.push(uiStore.launchErrorMessage);
    if (uiStore.launchErrorStderr) parts.push('---\n' + uiStore.launchErrorStderr);
    const text = parts.join('\n\n');
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (_) { /* give up silently */ }
    }
    copyLabel.value = (window.t && window.t('copied')) || 'Copied';
    copiedFlash.value = true;
    setTimeout(() => {
        copyLabel.value = baseCopyLabel();
        copiedFlash.value = false;
    }, 1200);
}

function close() {
    uiStore.closeLaunchErrorModal();
}
</script>

<style scoped>
.launch-error-modal {
    width: min(680px, 92vw);
    max-height: 82vh;
    display: flex;
    flex-direction: column;
}

.err-icon {
    color: #f39c12;
    margin-right: 6px;
}
.err-profile {
    font-weight: normal;
    opacity: 0.7;
    font-size: 13px;
    margin-left: 4px;
}

.err-message {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-primary);
    background: rgba(243, 156, 18, 0.08);
    border: 1px solid rgba(243, 156, 18, 0.3);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
    white-space: pre-wrap;
    word-break: break-word;
}

.err-stderr-block {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
}
.err-stderr-label {
    font-size: 12px;
    opacity: 0.7;
    margin-bottom: 4px;
    letter-spacing: 0.2px;
}
.err-stderr-body {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    max-height: 40vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
}
</style>
