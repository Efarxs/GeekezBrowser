import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ipcService } from '../services/ipc.service';

export const useUIStore = defineStore('ui', () => {
    // Modal visibility states
    const addModalVisible = ref(false);
    const editModalVisible = ref(false);
    const proxyModalVisible = ref(false);
    const exportModalVisible = ref(false);
    const settingsModalVisible = ref(false);
    const helpModalVisible = ref(false);
    const alertModalVisible = ref(false);
    const confirmModalVisible = ref(false);
    const inputModalVisible = ref(false);
    const subEditModalVisible = ref(false);
    const editProxyNodeModalVisible = ref(false);
    const passwordModalVisible = ref(false);
    const batchAddProxyModalVisible = ref(false);
    const exportSelectModalVisible = ref(false);
    const exportType = ref('all');
    
    // UI Theme & Lang
    const theme = ref(localStorage.getItem('geekez_theme') || 'geek');
    const lang = ref(localStorage.getItem('geekez_lang') || 'cn');

    // Dialog messages
    const alertMsg = ref('');
    const alertShowBtn = ref(true);
    const confirmMsg = ref('');
    const confirmNotes = ref('');
    const confirmOkText = ref('');
    const confirmCancelText = ref('');
    const inputModalTitle = ref('');
    const inputModalValue = ref('');

    // Launch-error modal (dedicated because the generic alert is 350px
    // centered — fine for short strings, unreadable for multi-line
    // Chromium stderr).
    const launchErrorModalVisible = ref(false);
    const launchErrorMessage = ref('');
    const launchErrorStderr = ref('');
    const launchErrorProfileName = ref('');
    let launchErrorOnClose = null;
    
    // Password Modal
    const passwordTitle = ref('');
    const passwordValue = ref('');
    const passwordConfirmValue = ref('');
    const passwordShowConfirm = ref(false);
    const passwordResolve = ref(null);

    const progressModalVisible = ref(false);
    const progressPercent = ref(0);
    const progressMessage = ref('');
    const progressTitle = ref('');
    const progressWarn = ref('');
    const progressStep = ref(0);
    const progressTotalSteps = ref(0);
    const progressProfileName = ref('');

    // Kernel (fingerprint-chromium) download modal
    const kernelModalVisible = ref(false);
    const kernelPhase = ref('idle'); // idle | network | resolve | download | extract | verify | done | error
    const kernelVersion = ref('');
    const kernelAssetName = ref('');
    const kernelMessage = ref('');
    const kernelBytes = ref(0);
    const kernelTotal = ref(0);
    const kernelPercent = ref(0);
    const kernelSpeed = ref(0);
    const kernelEta = ref(0);
    const kernelChunks = ref([]);
    const kernelError = ref('');
    const kernelCanCancel = ref(true);
    
    // Callbacks for legacy/store logic
    let confirmCallback = null;
    let confirmCancelCallback = null;
    let inputCallback = null;
    let passwordCallback = null;

    // Active ID for editing
    const currentEditId = ref(null);
    const currentSubEdit = ref(null);

    // Actions
    const openAddModal = () => { 
        console.log('[UIStore] openAddModal called');
        addModalVisible.value = true; 
    };
    const closeAddModal = () => { addModalVisible.value = false; };

    const openEditModal = (id) => {
        console.log('[UIStore] openEditModal called for ID:', id);
        currentEditId.value = id;
        editModalVisible.value = true;
    };
    const closeEditModal = () => {
        currentEditId.value = null;
        editModalVisible.value = false;
    };

    const openExportModal = () => { exportModalVisible.value = true; };
    const closeExportModal = () => { exportModalVisible.value = false; };
    
    const openExportSelectModal = (type) => {
        exportType.value = type;
        exportSelectModalVisible.value = true;
        exportModalVisible.value = false;
    };
    const closeExportSelectModal = () => { exportSelectModalVisible.value = false; };

    const openProxyManager = () => { proxyModalVisible.value = true; };
    const closeProxyManager = () => { proxyModalVisible.value = false; };

    const openSettings = () => { settingsModalVisible.value = true; };
    const closeSettings = () => { settingsModalVisible.value = false; };

    const setTheme = (newTheme) => {
        theme.value = newTheme;
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('geekez_theme', newTheme);
        
        const themeColors = {
            'geek': { bg: '#1e1e2d', symbol: '#ffffff' },
            'light': { bg: '#f0f2f5', symbol: '#000000' },
            'dark': { bg: '#121212', symbol: '#ffffff' }
        };
        const colors = themeColors[newTheme] || themeColors['geek'];
        ipcService.setTitleBarColor(colors);
    };

    const toggleLang = () => {
        const newLang = lang.value === 'cn' ? 'en' : 'cn';
        lang.value = newLang;
        localStorage.setItem('geekez_lang', newLang);
        ipcService.getSettings()
            .then((settings) => ipcService.saveSettings({ ...(settings || {}), lang: newLang }))
            .catch((e) => console.warn('[UIStore] Failed to persist language setting:', e));
        location.reload();
    };

    // Dialog Actions
    const showAlert = (msg, showBtn = true) => {
        alertMsg.value = msg;
        alertShowBtn.value = showBtn;
        alertModalVisible.value = true;
    };

    // Show the dedicated launch-error modal. Caller passes the message
    // (short reason) and stderr tail (may be multi-KB of Chromium log).
    // onClose fires after the user dismisses the modal — used by the
    // ProfileCard to clear its inline banner so the error can't get
    // re-triggered by another accidental click.
    const showLaunchError = ({ message = '', stderr = '', profileName = '', onClose = null } = {}) => {
        launchErrorMessage.value = message;
        launchErrorStderr.value = stderr;
        launchErrorProfileName.value = profileName;
        launchErrorOnClose = typeof onClose === 'function' ? onClose : null;
        launchErrorModalVisible.value = true;
    };

    const closeLaunchErrorModal = () => {
        launchErrorModalVisible.value = false;
        const cb = launchErrorOnClose;
        launchErrorOnClose = null;
        if (cb) {
            try { cb(); } catch (e) { console.warn('[UIStore] launch-error onClose threw:', e); }
        }
    };

    const showConfirm = (msg, callback, notes = '', options = {}) => {
        confirmMsg.value = msg;
        confirmNotes.value = notes;
        confirmOkText.value = options.okText || '';
        confirmCancelText.value = options.cancelText || '';
        confirmCallback = callback;
        confirmCancelCallback = typeof options.onCancel === 'function' ? options.onCancel : null;
        confirmModalVisible.value = true;
    };

    const handleConfirm = (result) => {
        confirmModalVisible.value = false;
        if (result && confirmCallback) confirmCallback();
        if (!result && confirmCancelCallback) confirmCancelCallback();
        confirmCallback = null;
        confirmCancelCallback = null;
        confirmOkText.value = '';
        confirmCancelText.value = '';
    };

    const showInput = (title, callback) => {
        inputModalTitle.value = title;
        inputModalValue.value = '';
        inputCallback = callback;
        inputModalVisible.value = true;
    };

    const submitInput = () => {
        const val = inputModalValue.value.trim();
        if (val && inputCallback) inputCallback(val);
        inputModalVisible.value = false;
        inputCallback = null;
    };

    const openPasswordModal = (title, showConfirm = true, callback = null) => {
        passwordTitle.value = title;
        passwordValue.value = '';
        passwordConfirmValue.value = '';
        passwordShowConfirm.value = showConfirm;
        passwordCallback = callback;
        passwordModalVisible.value = true;
    };

    const submitPassword = () => {
        if (passwordShowConfirm.value && passwordValue.value !== passwordConfirmValue.value) {
            showAlert(window.t ? window.t('passwordMismatch') : 'Passwords do not match');
            return;
        }
        if (passwordCallback) passwordCallback(passwordValue.value);
        passwordModalVisible.value = false;
        passwordCallback = null;
    };

    return {
        addModalVisible,
        editModalVisible,
        proxyModalVisible,
        exportModalVisible,
        settingsModalVisible,
        helpModalVisible,
        alertModalVisible,
        confirmModalVisible,
        inputModalVisible,
        subEditModalVisible,
        editProxyNodeModalVisible,
        passwordModalVisible,
        batchAddProxyModalVisible,
        exportSelectModalVisible,
        exportType,
        theme,
        lang,
        alertMsg,
        alertShowBtn,
        confirmMsg,
        confirmNotes,
        confirmOkText,
        confirmCancelText,
        inputModalTitle,
        inputModalValue,
        currentEditId,
        currentSubEdit,
        openAddModal,
        closeAddModal,
        openEditModal,
        closeEditModal,
        openExportModal,
        closeExportModal,
        openExportSelectModal,
        closeExportSelectModal,
        openProxyManager,
        closeProxyManager,
        openSettings,
        closeSettings,
        setTheme,
        toggleLang,
        showAlert,
        launchErrorModalVisible,
        launchErrorMessage,
        launchErrorStderr,
        launchErrorProfileName,
        showLaunchError,
        closeLaunchErrorModal,
        showConfirm,
        handleConfirm,
        showInput,
        submitInput,
        passwordTitle,
        passwordValue,
        passwordConfirmValue,
        passwordShowConfirm,
        progressModalVisible,
        progressPercent,
        progressMessage,
        progressTitle,
        progressWarn,
        progressStep,
        progressTotalSteps,
        progressProfileName,
        batchAddProxyModalVisible,
        openPasswordModal,
        submitPassword,
        kernelModalVisible,
        kernelPhase,
        kernelVersion,
        kernelAssetName,
        kernelMessage,
        kernelBytes,
        kernelTotal,
        kernelPercent,
        kernelSpeed,
        kernelEta,
        kernelChunks,
        kernelError,
        kernelCanCancel
    };
});
