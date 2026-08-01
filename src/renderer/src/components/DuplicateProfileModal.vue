<template>
    <div class="modal-overlay" :class="{ active: uiStore.duplicateModalVisible }" style="z-index: 3000;" @click.self="uiStore.closeDuplicateModal()">
        <div class="modal-content dup-modal-content">
            <h4 class="dup-title">{{ $t('dupTitle') || 'Duplicate profile' }}</h4>
            <div class="dup-source">{{ $t('dupSourceLabel') || 'Source' }}: <b>{{ uiStore.duplicateSourceName }}</b></div>

            <label class="dup-field-label">{{ $t('dupNameLabel') || 'New profile name' }}</label>
            <input
                ref="nameInput"
                v-model="newName"
                class="dup-name-input"
                type="text"
                :placeholder="uiStore.duplicateSourceName + '-copy'"
                @keydown.enter="submit"
            >

            <!-- reset-on-launch sources can't be faithfully cloned: the
                 fingerprint rerolls every launch, so login-state + frozen seed
                 are meaningless. Degrade to a plain config copy + explain why. -->
            <div v-if="uiStore.duplicateSourceRerolls" class="dup-degraded-note">
                {{ $t('dupDegradedNote') || 'This profile rerolls its fingerprint on every launch, so only the basic config is copied (no login state). This is the same as the classic duplicate.' }}
            </div>

            <template v-else>
                <div class="dup-section-label">{{ $t('dupFpLabel') || 'Fingerprint' }}</div>
                <label class="dup-radio">
                    <input type="radio" value="keep" v-model="fpMode">
                    <span>
                        <b>{{ $t('dupFpKeep') || 'Identical (faithful clone)' }}</b>
                        <em>{{ $t('dupFpKeepHint') || 'Same canvas/WebGL/audio hashes as the source. Safest for keeping one account on "one device".' }}</em>
                    </span>
                </label>
                <label class="dup-radio">
                    <input type="radio" value="new" v-model="fpMode">
                    <span>
                        <b>{{ $t('dupFpNew') || 'Fresh seed' }}</b>
                        <em>{{ $t('dupFpNewHint') || 'New fingerprint hashes. Use for an unrelated identity — carrying login state here can look like the same account on a new device.' }}</em>
                    </span>
                </label>

                <label class="dup-checkbox">
                    <input type="checkbox" v-model="withData">
                    <span>
                        <b>{{ $t('dupWithData') || 'Copy login state (cookies / localStorage)' }}</b>
                        <em>{{ $t('dupWithDataHint') || 'Requires the source to be stopped first.' }}</em>
                    </span>
                </label>
            </template>

            <div v-if="errorMsg" class="dup-error">{{ errorMsg }}</div>

            <div class="modal-footer dup-footer">
                <button class="outline" :disabled="busy" @click="uiStore.closeDuplicateModal()">{{ $t('cancel') || 'Cancel' }}</button>
                <button class="primary" :disabled="busy" @click="submit">{{ busy ? ($t('dupBusy') || 'Copying…') : ($t('dupConfirm') || 'Duplicate') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { useProfileStore } from '../store/useProfileStore';

const uiStore = useUIStore();
const profileStore = useProfileStore();

const t = (key, fallback) => (window.t ? window.t(key) : null) || fallback;

const newName = ref('');
const fpMode = ref('keep');       // 'keep' = faithful clone, 'new' = fresh seed
const withData = ref(true);       // copy login state by default
const busy = ref(false);
const errorMsg = ref('');
const nameInput = ref(null);

// Reset local state each time the modal opens.
watch(() => uiStore.duplicateModalVisible, (visible) => {
    if (!visible) return;
    newName.value = '';
    fpMode.value = 'keep';
    withData.value = true;
    busy.value = false;
    errorMsg.value = '';
    nextTick(() => { try { nameInput.value?.focus(); } catch (e) {} });
});

const submit = async () => {
    if (busy.value) return;
    errorMsg.value = '';
    busy.value = true;
    try {
        const rerolls = uiStore.duplicateSourceRerolls;
        const res = await window.electronAPI.duplicateProfile({
            sourceId: uiStore.duplicateSourceId,
            name: newName.value.trim(),
            // A rerolling source can't carry login state or freeze its seed;
            // force both off so the backend degrades cleanly.
            withData: rerolls ? false : withData.value,
            keepFingerprint: rerolls ? false : (fpMode.value === 'keep')
        });
        if (!res || res.success === false) {
            if (res && res.code === 'SOURCE_RUNNING') {
                errorMsg.value = t('dupSourceRunning', 'Stop the source profile before copying login state.');
            } else {
                errorMsg.value = (res && res.error) || t('dupFailed', 'Duplicate failed');
            }
            busy.value = false;
            return;
        }
        await profileStore.loadProfiles();
        uiStore.closeDuplicateModal();
        // Surface a soft warning if the browser_data copy itself failed.
        if (res.dataError) {
            uiStore.showAlert(t('dupDataPartial', 'Profile copied, but login-state copy failed: ') + res.dataError);
        }
    } catch (e) {
        errorMsg.value = e?.message || String(e);
        busy.value = false;
    }
};
</script>

<style scoped>
.dup-modal-content {
    width: min(90vw, 480px);
    max-height: 88vh;
    overflow-y: auto;
    padding: clamp(18px, 2.2vw, 26px);
    text-align: left;
}
.dup-title {
    margin: 0 0 10px;
    text-align: center;
}
.dup-source {
    font-size: 13px;
    opacity: 0.8;
    margin-bottom: 16px;
    text-align: center;
}
.dup-field-label,
.dup-section-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.85;
    margin: 10px 0 6px;
}
.dup-name-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border, #444);
    background: rgba(0, 0, 0, 0.15);
    color: var(--text-primary, #e0e0e0);
    font-size: 13px;
}
.dup-radio,
.dup-checkbox {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 9px 10px;
    margin-top: 8px;
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
}
.dup-radio:hover,
.dup-checkbox:hover {
    border-color: var(--accent, #4285f4);
    background: rgba(66, 133, 244, 0.06);
}
.dup-radio input,
.dup-checkbox input {
    /* Override the global `input { width:100%; padding:8px; margin-bottom:10px }`
       rule which otherwise blows radios/checkboxes up to full-width blocks. */
    width: 16px;
    height: 16px;
    min-width: 16px;
    margin: 2px 0 0 0;
    padding: 0;
    flex-shrink: 0;
    accent-color: var(--accent, #4285f4);
    cursor: pointer;
}
.dup-radio span,
.dup-checkbox span {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.dup-radio b,
.dup-checkbox b {
    font-size: 13px;
    font-weight: 600;
}
.dup-radio em,
.dup-checkbox em {
    font-style: normal;
    font-size: 11.5px;
    opacity: 0.7;
    line-height: 1.4;
}
.dup-checkbox {
    margin-top: 14px;
}
.dup-degraded-note {
    margin: 14px 0 4px;
    padding: 10px 12px;
    font-size: 12.5px;
    line-height: 1.5;
    border-radius: 6px;
    background: rgba(243, 156, 18, 0.10);
    border: 1px solid rgba(243, 156, 18, 0.35);
    color: #f0c070;
}
.dup-error {
    margin-top: 12px;
    padding: 8px 10px;
    font-size: 12.5px;
    border-radius: 6px;
    background: rgba(231, 76, 60, 0.12);
    border: 1px solid rgba(231, 76, 60, 0.4);
    color: #f5a89f;
}
.dup-footer {
    display: flex;
    justify-content: center;
    gap: 10px;
    border: none;
    padding: 0;
    margin-top: 18px;
}
.dup-footer button {
    min-width: 100px;
}
</style>
