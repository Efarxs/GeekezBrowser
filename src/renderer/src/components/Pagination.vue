<template>
    <div class="pagination-bar">
        <span class="pagination-info">{{ $t('totalProfiles') || 'Total' }}: {{ totalCount }}</span>
        <div class="pagination-controls">
            <button class="page-btn" :disabled="currentPage <= 1" @click="$emit('page-change', currentPage - 1)">
                &lsaquo;
            </button>
            <template v-for="p in displayPages" :key="String(p)">
                <span v-if="p === '...'" class="page-ellipsis">...</span>
                <button v-else class="page-btn" :class="{ active: p === currentPage }" @click="$emit('page-change', p)">
                    {{ p }}
                </button>
            </template>
            <button class="page-btn" :disabled="currentPage >= totalPages" @click="$emit('page-change', currentPage + 1)">
                &rsaquo;
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    currentPage: { type: Number, required: true },
    totalPages: { type: Number, required: true },
    totalCount: { type: Number, required: true }
});

defineEmits(['page-change']);

const displayPages = computed(() => {
    const total = props.totalPages;
    const current = props.currentPage;
    const pages = [];

    if (total <= 5) {
        for (let i = 1; i <= total; i++) pages.push(i);
    } else {
        pages.push(1);
        if (current > 3) pages.push('...');
        const start = Math.max(2, current - 1);
        const end = Math.min(total - 1, current + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (current < total - 2) pages.push('...');
        pages.push(total);
    }
    return pages;
});
</script>

<style scoped>
.pagination-bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    padding: 10px 16px;
    border-top: 1px solid var(--border, #333);
    background: var(--card-bg, #1a1a1a);
    flex-shrink: 0;
    gap: 20px;
}

.pagination-info {
    font-size: 13px;
    color: var(--text-secondary, #999);
    white-space: nowrap;
}

.pagination-controls {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
}

.page-btn {
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    border-radius: 4px;
    border: 1px solid var(--border, #333);
    background: var(--bg-color, #111);
    color: var(--text-primary, #fff);
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}

.page-btn:hover:not(:disabled):not(.active) {
    background: var(--hover-bg, #2a2a2a);
}

.page-btn.active {
    background: var(--accent, #4a9eff);
    color: var(--bg-color, #111);
    border-color: var(--accent, #4a9eff);
}

.page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.page-ellipsis {
    min-width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #999);
    font-size: 13px;
}
</style>
