import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { profileService } from '../services/profile.service';

export const useProfileStore = defineStore('profile', () => {
    // State
    const profiles = ref([]);
    const runningIds = ref([]);
    const launchingIds = ref([]);
    const searchText = ref('');
    const selectedTag = ref('');
    const selectedIds = ref([]);
    const viewMode = ref(localStorage.getItem('geekez_view') || 'list');

    // Pagination state
    const currentPage = ref(1);
    const pageSize = ref(15);
    const totalCount = ref(0);
    const totalPages = ref(0);
    const availableTags = ref([]);

    // Actions
    const loadProfiles = async () => {
        try {
            const result = await profileService.loadProfilesPaged({
                page: currentPage.value,
                pageSize: pageSize.value,
                search: searchText.value,
                tag: selectedTag.value
            });
            profiles.value = result.items;
            totalCount.value = result.totalCount;
            totalPages.value = result.totalPages;

            const runtimeState = await profileService.getRuntimeState();
            runningIds.value = runtimeState?.runningIds || await profileService.getRunningIds();
            launchingIds.value = runtimeState?.launchingIds || [];
            const profileIdSet = new Set(profiles.value.map(p => p.id));
            selectedIds.value = selectedIds.value.filter(id => profileIdSet.has(id));
        } catch (e) {
            console.error('Failed to load profiles:', e);
        }
    };

    const loadTags = async () => {
        try {
            availableTags.value = await profileService.getAllTags();
        } catch (e) {
            console.error('Failed to load tags:', e);
        }
    };

    const toggleViewMode = () => {
        viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
        localStorage.setItem('geekez_view', viewMode.value);
    };

    const setSearchText = (text) => {
        searchText.value = text;
        currentPage.value = 1;
        loadProfiles();
    };

    const setSelectedTag = (tag) => {
        selectedTag.value = tag || '';
        currentPage.value = 1;
        loadProfiles();
    };

    const setPage = (page) => {
        currentPage.value = page;
        loadProfiles();
    };

    // Getters
    const filteredProfiles = computed(() => profiles.value);

    const selectedCount = computed(() => selectedIds.value.length);

    const isSelected = (id) => selectedIds.value.includes(id);

    const toggleSelected = (id, forceValue = null) => {
        const has = selectedIds.value.includes(id);
        const shouldSelect = forceValue === null ? !has : !!forceValue;
        if (shouldSelect && !has) selectedIds.value.push(id);
        if (!shouldSelect && has) selectedIds.value = selectedIds.value.filter(item => item !== id);
    };

    const clearSelection = () => {
        selectedIds.value = [];
    };

    const toggleSelectAllFiltered = () => {
        const filteredIds = filteredProfiles.value.map(profile => profile.id);
        const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.value.includes(id));
        if (allSelected) {
            selectedIds.value = selectedIds.value.filter(id => !filteredIds.includes(id));
            return;
        }
        const next = new Set(selectedIds.value);
        filteredIds.forEach(id => next.add(id));
        selectedIds.value = Array.from(next);
    };

    const isRunning = (id) => runningIds.value.includes(id);
    const isLaunching = (id) => launchingIds.value.includes(id);

    const createProfile = async (data) => {
        try {
            await profileService.saveProfile(data);
            await loadProfiles();
            await loadTags();
        } catch (e) {
            console.error('Failed to create profile:', e);
            throw e;
        }
    };

    const updateProfile = async (profile) => {
        try {
            await profileService.updateProfile(profile);
            await loadProfiles();
            await loadTags();
        } catch (e) {
            console.error('Failed to update profile:', e);
            throw e;
        }
    };

    const deleteProfile = async (id) => {
        try {
            await profileService.deleteProfile(id);
            if (profiles.value.length === 1 && currentPage.value > 1) {
                currentPage.value--;
            }
            await loadProfiles();
            await loadTags();
        } catch (e) {
            console.error('Failed to delete profile:', e);
            throw e;
        }
    };

    return {
        profiles,
        runningIds,
        launchingIds,
        searchText,
        selectedTag,
        selectedIds,
        viewMode,
        // Pagination
        currentPage,
        totalCount,
        totalPages,
        availableTags,
        // Actions
        loadProfiles,
        loadTags,
        toggleViewMode,
        setSearchText,
        setSelectedTag,
        setPage,
        // Getters
        filteredProfiles,
        selectedCount,
        isSelected,
        toggleSelected,
        clearSelection,
        toggleSelectAllFiltered,
        isRunning,
        isLaunching,
        createProfile,
        updateProfile,
        deleteProfile
    };
});
