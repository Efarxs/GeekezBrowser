<template>
    <div class="kernel-version-select">
        <label class="label-tiny">{{ t('kernelVersionLabel') }}</label>
        <select :value="modelValue" @change="onChange" :disabled="loading">
            <option value="">{{ defaultLabel }}</option>
            <option v-for="opt in mergedOptions" :key="opt.version" :value="opt.version">
                {{ opt.version }}{{ opt.installed ? t('kernelVersionInstalledSuffix') : t('kernelVersionDownloadSuffix') }}
            </option>
        </select>
        <div class="hint-text">{{ t('kernelVersionHint') }}</div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const props = defineProps({
    modelValue: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue']);

const t = (key) => (window.t ? window.t(key) : key);

const installed = ref([]);
const available = ref([]);
const pinned = ref('');
const loading = ref(true);

const defaultLabel = computed(() => `${t('kernelVersionDefault')}${pinned.value ? ` — ${pinned.value}` : ''}`);

// Union of installed versions + first 5 available versions from GitHub.
// If the currently-selected profile version is not in either list (e.g.
// user selected an older release that fell off the top-N), include it
// too so the dropdown reflects the actual saved value.
const mergedOptions = computed(() => {
    const map = new Map();
    for (const v of installed.value) map.set(v.version, { version: v.version, installed: true });
    for (const v of available.value.slice(0, 5)) {
        if (!map.has(v.version)) map.set(v.version, { version: v.version, installed: false });
    }
    if (props.modelValue && !map.has(props.modelValue)) {
        map.set(props.modelValue, { version: props.modelValue, installed: false });
    }
    return Array.from(map.values()).sort((a, b) => {
        const pa = a.version.split('.').map(n => parseInt(n, 10) || 0);
        const pb = b.version.split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pb[i] || 0) - (pa[i] || 0);
            if (diff) return diff;
        }
        return 0;
    });
});

function onChange(e) {
    emit('update:modelValue', e.target.value);
}

onMounted(async () => {
    try {
        const [inst, avail] = await Promise.all([
            window.electronAPI?.listInstalledKernels?.() || Promise.resolve({ ok: false }),
            window.electronAPI?.listAvailableKernels?.() || Promise.resolve({ ok: false })
        ]);
        if (inst?.ok) {
            installed.value = inst.installed || [];
            pinned.value = inst.pinned || '';
        }
        if (avail?.ok) {
            available.value = avail.available || [];
        }
    } catch (_) { /* silent */ } finally {
        loading.value = false;
    }
});
</script>

<style scoped>
.kernel-version-select { margin-top: 10px; }
</style>
