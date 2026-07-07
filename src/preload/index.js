// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfilesPaged: (options) => ipcRenderer.invoke('get-profiles-paged', options),
    getAllTags: () => ipcRenderer.invoke('get-all-tags'),
    saveProfile: (data) => ipcRenderer.invoke('save-profile', data),
    updateProfile: (data) => ipcRenderer.invoke('update-profile', data),
    deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),
    launchProfile: (id) => ipcRenderer.invoke('launch-profile', id),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
    exportProfile: (id) => ipcRenderer.invoke('export-profile', id),
    importProfile: () => ipcRenderer.invoke('import-profile'),
    // 通用 invoke，支持多参数传递
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    getRunningIds: () => ipcRenderer.invoke('get-running-ids'),
    onProfileStatus: (callback) => ipcRenderer.on('profile-status', (event, data) => callback(data)),
    // API events
    onRefreshProfiles: (callback) => ipcRenderer.on('refresh-profiles', () => callback()),
    onApiLaunchProfile: (callback) => ipcRenderer.on('api-launch-profile', (event, id) => callback(id)),
    onExtensionInstallProgress: (callback) => ipcRenderer.on('extension-install-progress', (event, payload) => callback(payload)),
    onProfileLaunchProgress: (callback) => ipcRenderer.on('profile-launch-progress', (event, payload) => callback(payload)),
    onProfileCrash: (callback) => ipcRenderer.on('profile-crash', (event, payload) => callback(payload)),
    exportCookies: (profileId, format) => ipcRenderer.invoke('cookies-export', profileId, format),
    importCookies: (profileId, format) => ipcRenderer.invoke('cookies-import', profileId, format),
    // Kernel (fingerprint-chromium) install management
    getKernelStatus: () => ipcRenderer.invoke('kernel:get-status'),
    ensureKernel: () => ipcRenderer.invoke('kernel:ensure'),
    cancelKernelDownload: () => ipcRenderer.invoke('kernel:cancel'),
    onKernelProgress: (callback) => ipcRenderer.on('kernel:progress', (event, payload) => callback(payload)),
    listInstalledKernels: () => ipcRenderer.invoke('kernel:list-installed'),
    listAvailableKernels: (opts) => ipcRenderer.invoke('kernel:list-available', opts || {}),
    installKernelVersion: (version) => ipcRenderer.invoke('kernel:install-version', version),
    uninstallKernelVersion: (version) => ipcRenderer.invoke('kernel:uninstall-version', version)
});
