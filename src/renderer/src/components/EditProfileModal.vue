<template>
  <div v-show="uiStore.editModalVisible" class="modal-overlay" @mousedown.self="uiStore.closeEditModal">
    <div class="modal-content">
      <div class="modal-header">
        <span>{{ viewOnly ? $t('viewFingerprint') : $t('editFingerprint') }}</span>
        <span style="cursor:pointer" @click="uiStore.closeEditModal">✕</span>
      </div>
      <div class="modal-body">
        <div v-if="viewOnly" class="viewonly-banner">
          <span class="viewonly-icon">👁</span>
          <div class="viewonly-text">
            <div class="viewonly-title">{{ $t('viewOnlyTitle') }}</div>
            <div class="viewonly-hint">{{ $t('viewOnlyHint') }}</div>
          </div>
        </div>

        <div class="tab-header" role="tablist">
          <div
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            role="tab"
            :aria-selected="activeTab === tab.key"
            @click="activeTab = tab.key"
          >{{ $t(tab.i18n) }}</div>
        </div>

        <fieldset class="form-fieldset" :disabled="viewOnly">
          <!-- Basic: identity + network + screen -->
          <div v-show="activeTab === 'basic'" class="form-grid">
            <div class="field">
              <label class="label-tiny">{{ $t('profileName') }}</label>
              <input v-model="form.name" type="text" placeholder="Name">
            </div>
            <div class="field">
              <label class="label-tiny">{{ $t('tagsLabel') }}</label>
              <input v-model="form.tags" type="text" placeholder="tiktok, fb...">
            </div>

            <div class="field field-full">
              <label class="label-tiny">{{ $t('profileNotesLabel') }}</label>
              <textarea
                v-model="form.notes"
                rows="3"
                class="profile-notes-textarea"
                :placeholder="$t('profileNotesPlaceholder')"
                spellcheck="false"
                autocomplete="off"
              ></textarea>
              <div class="hint-text">{{ $t('profileNotesHint') }}</div>
            </div>

            <div class="field field-full">
              <label class="label-tiny">{{ $t('proxyLink') }}</label>
              <textarea v-model="form.proxyStr" rows="3"></textarea>
            </div>

            <div class="field field-full">
              <label class="label-tiny">{{ $t('preProxySetting') }}</label>
              <select v-model="preProxyMode">
                <option value="global">{{ $t('preProxyModeGlobal') }}</option>
                <option value="pool">{{ $t('preProxyModePool') }}</option>
                <option value="dedicated">{{ $t('preProxyModeDedicated') }}</option>
                <option value="off">{{ $t('preProxyModeOff') }}</option>
              </select>
              <div v-if="preProxyMode === 'dedicated'" class="dedicated-preproxy">
                <input v-model="form.preProxyStr" :disabled="viewOnly" placeholder="socks5://127.0.0.1:7890" class="mono-text" spellcheck="false" autocomplete="off">
                <div class="hint-text">{{ $t('preProxyStrHint') }}</div>
                <div v-if="!(form.proxyStr || '').trim()" class="warning-text">{{ $t('preProxyNoMainHint') }}</div>
              </div>
            </div>
            <div class="field">
              <label class="label-tiny">{{ $t('screenRes') }}</label>
              <div class="flex-row gap-5">
                <input v-model.number="form.resW" type="number">
                <input v-model.number="form.resH" type="number">
              </div>
            </div>
          </div>

          <!-- Fingerprint: locale + browser identity + reset-on-launch -->
          <div v-show="activeTab === 'fingerprint'" class="form-grid">
            <div class="field">
              <label class="label-tiny">{{ $t('timezoneLabel') }}</label>
              <div class="timezone-wrapper">
                <input v-model="timezoneSearch" type="text" placeholder="Type to search or select..." autocomplete="off" @focus="showTimezoneList = true">
                <div v-if="showTimezoneList" class="timezone-dropdown active">
                  <div v-for="tz in filteredTimezones" :key="tz" class="timezone-item" @click="selectTimezone(tz)">
                    {{ tz }}
                  </div>
                </div>
              </div>
            </div>
            <div class="field">
              <label class="label-tiny">{{ $t('languageLabel') }}</label>
              <div class="timezone-wrapper">
                <input v-model="languageSearch" type="text" placeholder="Type to search language..." autocomplete="off" @focus="showLanguageList = true">
                <div v-if="showLanguageList" class="timezone-dropdown active">
                  <div v-for="lang in filteredLanguages" :key="lang.code" class="timezone-item" @click="selectLanguage(lang)">
                    {{ lang.name }} ({{ lang.code }})
                  </div>
                </div>
              </div>
            </div>

            <div class="field field-full">
              <label class="label-tiny">{{ $t('locationLabel') }}</label>
              <div class="timezone-wrapper">
                <input v-model="citySearch" type="text" placeholder="Type to search city..." autocomplete="off" @focus="showCityList = true">
                <div v-if="showCityList" class="timezone-dropdown active">
                  <div v-for="city in filteredCities" :key="city.name" class="timezone-item" @click="selectCity(city)">
                    {{ city.name }}
                  </div>
                </div>
              </div>
              <div class="hint-text">{{ $t('geoHint') }}</div>
            </div>

            <template v-if="showUaModify">
              <div class="field">
                <label class="label-tiny">{{ $t('browserVersionPresetLabel') }}</label>
                <select v-model="form.browserVersionPreset">
                  <option v-for="opt in browserVersionPresetOptions" :key="opt.value" :value="opt.value">
                    {{ getOptionLabel(opt) }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label class="label-tiny">{{ $t('platformLabel') }}</label>
                <select v-model="form.platform">
                  <option v-for="opt in platformOptions" :key="opt.value" :value="opt.value">
                    {{ getOptionLabel(opt) }}
                  </option>
                </select>
              </div>

              <div class="field field-full">
                <label class="label-tiny">{{ $t('customUaLabel') }}</label>
                <textarea
                  v-model="form.customUserAgent"
                  rows="3"
                  class="mono-text custom-ua-textarea"
                  :placeholder="$t('customUaPlaceholder')"
                  spellcheck="false"
                  autocomplete="off"
                ></textarea>
                <div class="ua-actions">
                  <button type="button" class="outline ua-random-btn" @click="randomizeCustomUa">{{ $t('randomizeUa') }}</button>
                  <span class="hint-text ua-hint">{{ $t('customUaHint') }}</span>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="field field-full">
                <label class="label-tiny">{{ $t('platformLabel') }}</label>
                <select v-model="form.platform">
                  <option v-for="opt in platformOptions" :key="opt.value" :value="opt.value">
                    {{ getOptionLabel(opt) }}
                  </option>
                </select>
              </div>
            </template>

            <label class="reset-toggle field field-full">
              <input type="checkbox" v-model="form.resetOnLaunch">
              <span class="reset-toggle-checkmark"></span>
              <div class="reset-toggle-body">
                <div class="reset-toggle-title">{{ $t('resetOnLaunchLabel') }}</div>
                <div class="hint-text">{{ $t('resetOnLaunchHint') }}</div>
              </div>
            </label>
          </div>

          <!-- Advanced: kernel + custom args + disable spoofing + debug port -->
          <div v-show="activeTab === 'advanced'" class="form-grid">
            <div class="field field-full">
              <KernelVersionSelect v-model="form.kernelVersion" />
            </div>

            <div v-if="settings.enableRemoteDebugging" class="field field-full">
              <label class="label-tiny">Remote Debugging Port</label>
              <input v-model.number="form.debugPort" type="number" placeholder="Leave empty for auto">
              <div class="warning-text">⚠️ Enabling debugging port may increase detection risk</div>
            </div>

            <div v-if="settings.enableCustomArgs" class="field field-full">
              <label class="label-tiny">{{ $t('customArgsLabel') }}</label>
              <textarea v-model="form.customArgs" rows="2" placeholder="--start-maximized" class="mono-text"></textarea>
              <div class="hint-text">{{ $t('customArgsHint') }}</div>
            </div>

            <div v-if="settings.enableCustomArgs" class="field field-full">
              <label class="label-tiny">{{ $t('disableSpoofingLabel') }}</label>
              <div class="disable-spoof-grid">
                <label v-for="cat in disableSpoofCategories" :key="cat.value" class="disable-spoof-item">
                  <input type="checkbox" :value="cat.value" v-model="form.disabledSpoofing">
                  <span>{{ $t(cat.i18n) }}</span>
                </label>
              </div>
              <div class="hint-text">{{ $t('disableSpoofingHint') }}</div>
            </div>

            <label class="reset-toggle field field-full">
              <input type="checkbox" v-model="form.headless" :disabled="viewOnly">
              <span class="reset-toggle-checkmark"></span>
              <div class="reset-toggle-body">
                <div class="reset-toggle-title">{{ $t('headlessLabel') }}</div>
                <div class="hint-text">{{ $t('headlessHint') }}</div>
              </div>
            </label>
          </div>
        </fieldset>
      </div>
      <div class="modal-footer">
        <button v-if="viewOnly" @click="uiStore.closeEditModal">{{ $t('close') }}</button>
        <template v-else>
          <button class="outline" @click="uiStore.closeEditModal">{{ $t('cancel') }}</button>
          <button @click="handleSave">{{ $t('save') }}</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { useProfileStore } from '../store/useProfileStore';
import KernelVersionSelect from './KernelVersionSelect.vue';
import {
  browserVersionPresetOptions,
  platformOptions,
  getOptionLabel,
  generateRandomUserAgent
} from '../utils/fingerprintOptions';

const uiStore = useUIStore();
const profileStore = useProfileStore();

const settings = ref({});
const showUaModify = ref(false);

const viewOnly = computed(() => {
    const id = uiStore.currentEditId;
    if (!id) return false;
    return profileStore.isRunning(id) || profileStore.isLaunching(id);
});

// Single-select pre-proxy mode, derived from (preProxyOverride, preProxyStr).
// Kept as its own ref so the dropdown stays put even if the dedicated URL is
// briefly empty; override/preProxyStr are recomputed from it at save time.
const preProxyMode = ref('global');
function derivePreProxyMode(override, preProxyStr) {
    if ((override || 'default') === 'off') return 'off';
    if ((preProxyStr || '').trim()) return 'dedicated';
    if (override === 'on') return 'pool';
    return 'global';
}
const form = reactive({
  name: '',
  tags: '',
  notes: '',
  proxyStr: '',
  timezone: 'Auto',
  city: 'Auto (IP Based)',
  language: 'auto',
  preProxyOverride: 'default',
  preProxyStr: '',
  resW: 1920,
  resH: 1080,
  geolocation: null,
  debugPort: null,
  customArgs: '',
  browserVersionPreset: 'none',
  platform: 'Win32',
  customUserAgent: '',
  resetOnLaunch: false,
  kernelVersion: '',
  disabledSpoofing: [],
  headless: false,
});

const disableSpoofCategories = [
  { value: 'canvas', i18n: 'disableSpoofingCanvas' },
  { value: 'audio', i18n: 'disableSpoofingAudio' },
  { value: 'clientrects', i18n: 'disableSpoofingClientRects' },
  { value: 'gpu', i18n: 'disableSpoofingGpu' }
];

const tabs = [
  { key: 'basic', i18n: 'tabBasic' },
  { key: 'fingerprint', i18n: 'tabFingerprint' },
  { key: 'advanced', i18n: 'tabAdvanced' }
];
const activeTab = ref('basic');

function randomizeCustomUa() {
  const preset = parseBrowserVersionPreset(form.browserVersionPreset);
  const browserType = preset.browserType === 'edge' ? 'edge' : 'chrome';
  form.customUserAgent = generateRandomUserAgent({
    platform: form.platform,
    browserType
  });
}

function parseBrowserVersionPreset(preset) {
  if (!preset || preset === 'none') {
    return { uaMode: 'none', browserType: 'auto', browserMajorVersion: 'auto' };
  }
  if (preset === 'auto') {
    return { uaMode: 'spoof', browserType: 'auto', browserMajorVersion: 'auto' };
  }
  const [browserTypeRaw, majorRaw] = String(preset).split(':');
  const browserType = browserTypeRaw === 'edge' ? 'edge' : 'chrome';
  const major = Number(majorRaw);
  if (!Number.isFinite(major)) {
    return { uaMode: 'none', browserType: 'auto', browserMajorVersion: 'auto' };
  }
  return { uaMode: 'spoof', browserType, browserMajorVersion: major };
}

function toBrowserVersionPreset(uaMode, browserType, browserMajorVersion) {
  if (uaMode === 'none') return 'none';
  const type = browserType === 'edge' ? 'edge' : (browserType === 'chrome' ? 'chrome' : 'auto');
  const major = Number(browserMajorVersion);
  if (type === 'auto' || !Number.isFinite(major)) return 'none';
  const preset = `${type}:${major}`;
  const exists = browserVersionPresetOptions.some(opt => opt.value === preset);
  return exists ? preset : 'none';
}

// Searchable Dropdowns State
const AUTO_TIMEZONE_LABEL = 'Auto (IP Based)';
const LEGACY_AUTO_TIMEZONE_LABEL = 'Auto (No Change)';
const AUTO_CITY = { name: 'Auto (IP Based)', lat: null, lng: null };

const timezoneSearch = ref(AUTO_TIMEZONE_LABEL);
const showTimezoneList = ref(false);
const citySearch = ref('Auto (IP Based)');
const showCityList = ref(false);
const languageSearch = ref('Auto (System Default)');
const showLanguageList = ref(false);

const allTimezones = window.TIMEZONES || [];
const allCities = [AUTO_CITY, ...(window.CITY_DATA || [])];
const allLanguages = window.LANGUAGE_DATA || [
  { name: 'Auto (System Default)', code: 'auto' },
  { name: 'English (US)', code: 'en-US' }
];

// Computed filters
const filteredTimezones = computed(() => {
  const s = timezoneSearch.value.toLowerCase();
  return allTimezones.filter(tz => tz.toLowerCase().includes(s)).slice(0, 50);
});
const filteredCities = computed(() => {
  const s = citySearch.value.toLowerCase();
  return allCities.filter(c => c.name.toLowerCase().includes(s)).slice(0, 50);
});
const filteredLanguages = computed(() => {
  const s = languageSearch.value.toLowerCase();
  return allLanguages.filter(l => l.name.toLowerCase().includes(s) || l.code.toLowerCase().includes(s));
});

// Backfill logic
watch(() => uiStore.editModalVisible, async (visible) => {
  if (visible && uiStore.currentEditId) {
    const p = profileStore.profiles.find(x => x.id === uiStore.currentEditId);
    if (!p) return;

    // Always land on the Basic tab when the modal re-opens; users
    // expect editing to start at the top even if last time they were
    // on Advanced.
    activeTab.value = 'basic';

    settings.value = await window.electronAPI.getSettings();
    showUaModify.value = !!(settings.value?.enableUaModify ?? settings.value?.enableUaWebglModify);
    const fp = p.fingerprint || {};

    form.name = p.name;
    form.proxyStr = p.proxyStr;
    form.tags = (p.tags || []).join(', ');
    form.notes = p.notes || p.note || p.profileNotes || '';
    form.preProxyOverride = p.preProxyOverride || 'default';
    form.preProxyStr = p.preProxyStr || '';
    preProxyMode.value = derivePreProxyMode(form.preProxyOverride, form.preProxyStr);
    form.resW = fp.screen?.width || 1920;
    form.resH = fp.screen?.height || 1080;
    form.debugPort = p.debugPort || null;
    form.customArgs = p.customArgs || '';
    form.browserVersionPreset = toBrowserVersionPreset(fp.uaMode, fp.browserType, fp.browserMajorVersion);
    // Legacy 'auto' values (from before we removed OS auto-random) show as Windows.
    form.platform = (!fp.platform || fp.platform === 'auto') ? 'Win32' : fp.platform;
    form.customUserAgent = fp.userAgent || '';
    form.resetOnLaunch = !!p.resetOnLaunch;
    form.kernelVersion = p.kernelVersion || '';
    form.disabledSpoofing = Array.isArray(fp.disabledSpoofing)
      ? fp.disabledSpoofing.filter(c => ['canvas','audio','clientrects','gpu'].includes(c))
      : [];
    form.headless = !!p.headless;

    // Timezone
    form.timezone = fp.timezone || 'Auto';
    timezoneSearch.value = form.timezone === 'Auto' ? AUTO_TIMEZONE_LABEL : form.timezone;

    // City
    form.city = fp.city || null;
    form.geolocation = fp.geolocation || null;
    citySearch.value = form.city || 'Auto (IP Based)';

    // Language
    form.language = fp.language || 'auto';
    const langObj = allLanguages.find(l => l.code === form.language);
    languageSearch.value = langObj ? langObj.name : 'Auto (System Default)';
  }
});

function selectTimezone(tz) {
  const isAuto = tz === AUTO_TIMEZONE_LABEL || tz === LEGACY_AUTO_TIMEZONE_LABEL || tz === 'Auto';
  form.timezone = isAuto ? 'Auto' : tz;
  timezoneSearch.value = isAuto ? AUTO_TIMEZONE_LABEL : tz;
  showTimezoneList.value = false;
}

function selectCity(city) {
  if (city.name === 'Auto (IP Based)') {
    form.city = null;
    form.geolocation = null;
    citySearch.value = 'Auto (IP Based)';
  } else {
    form.city = city.name;
    form.geolocation = { latitude: city.lat, longitude: city.lng, accuracy: 100 };
    citySearch.value = city.name;
  }
  showCityList.value = false;
}

function selectLanguage(lang) {
  form.language = lang.code;
  languageSearch.value = lang.name;
  showLanguageList.value = false;
}

function handleGlobalClick(e) {
  if (!e.target.closest('.timezone-wrapper')) {
    showTimezoneList.value = false;
    showCityList.value = false;
    showLanguageList.value = false;
  }
}

onMounted(() => {
  window.addEventListener('mousedown', handleGlobalClick);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleGlobalClick);
});

async function handleSave() {
  try {
    const p = profileStore.profiles.find(x => x.id === uiStore.currentEditId);
    if (!p) return;
    if (profileStore.isRunning(p.id) || profileStore.isLaunching(p.id)) {
      uiStore.showAlert(window.t('runningNoEdit') || 'Cannot edit a running profile.');
      return;
    }
    // Cross-major kernel downgrades are a distinct anti-fraud signal (bot
    // farms notoriously ship old Chromium images), so we gate the save on
    // an explicit confirm. Empty kernel means "app default" (pinned) —
    // treat as no-warn since pinned generally tracks the latest major.
    const storedMajor = parseInt(String(p.fingerprint?.browserMajorVersion || '').split('.')[0], 10) || 0;
    const newKernelMajor = form.kernelVersion
      ? parseInt(String(form.kernelVersion).split('.')[0], 10) || 0
      : 0;
    if (newKernelMajor > 0 && storedMajor > 0 && newKernelMajor < storedMajor) {
      const title = (window.t('kernelDowngradeWarnTitle') || 'Downgrade kernel from Chrome {from} to Chrome {to}?')
        .replace('{from}', storedMajor)
        .replace('{to}', newKernelMajor);
      const hint = window.t('kernelDowngradeWarnHint') || '';
      const proceed = await new Promise(resolve => {
        uiStore.showConfirm(
          title,
          () => resolve(true),
          hint,
          { onCancel: () => resolve(false) }
        );
      });
      if (!proceed) return;
    }

    const browserPreset = parseBrowserVersionPreset(form.browserVersionPreset);
    const trimmedUa = (form.customUserAgent || '').trim();
    const uaMode = trimmedUa ? 'spoof' : browserPreset.uaMode;

    // Map the single-select pre-proxy mode back to (override, preProxyStr).
    const dedicatedUrl = (form.preProxyStr || '').trim();
    let preProxyOverride = 'default';
    let preProxyStr = '';
    if (preProxyMode.value === 'off') { preProxyOverride = 'off'; preProxyStr = dedicatedUrl; }
    else if (preProxyMode.value === 'pool') { preProxyOverride = 'on'; preProxyStr = ''; }
    else if (preProxyMode.value === 'dedicated') { preProxyOverride = 'default'; preProxyStr = dedicatedUrl; }
    else { preProxyOverride = 'default'; preProxyStr = ''; }

    const tagsRaw = (form.tags || '').toString();
    const updated = {
      ...p,
      name: form.name,
      proxyStr: form.proxyStr,
      tags: tagsRaw.split(/[,，]/).map(s => s.trim()).filter(s => s),
      notes: form.notes,
      preProxyOverride: preProxyOverride,
      preProxyStr: preProxyStr,
      uaMode,
      browserType: browserPreset.browserType,
      browserMajorVersion: browserPreset.browserMajorVersion,
      fingerprint: {
        ...(p.fingerprint || {}),
        screen: { width: form.resW, height: form.resH },
        window: { width: form.resW, height: form.resH },
        timezone: form.timezone,
        city: form.city,
        geolocation: form.geolocation,
        language: form.language,
        uaMode,
        browserType: browserPreset.browserType,
        browserMajorVersion: browserPreset.browserMajorVersion,
        platform: form.platform,
        userAgent: trimmedUa || null,
        disabledSpoofing: [...form.disabledSpoofing]
      },
      debugPort: form.debugPort,
      customArgs: form.customArgs,
      ignoreCertErrors: true,
      resetOnLaunch: !!form.resetOnLaunch,
      kernelVersion: form.kernelVersion || null,
      headless: !!form.headless
    };

    // 这一步彻底洗掉 Vue 的 Proxy 深度监控包装，防止 Electron 的原生底层报错 "An object could not be cloned"
    const safeUpdated = JSON.parse(JSON.stringify(updated));
    await profileStore.updateProfile(safeUpdated);
    uiStore.closeEditModal();
  } catch (err) {
    console.error('Update profile failed:', err);
    uiStore.showAlert("Update Failed: " + err.message);
  }
}
</script>

<style scoped>
/* Wider than the default 500px so the 2-col grid has room for two
   controls plus their labels without cramping. Capped at viewport
   width so small windows still work. */
.modal-content {
  width: min(720px, 92vw);
}

/* Tab bar. Buttons render as underlined text buttons — flat, no
   background, so they don't steal attention from the form itself. */
.tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
  flex-shrink: 0;
}
.tab-btn {
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  opacity: 0.55;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: opacity 0.15s, border-color 0.15s;
  user-select: none;
  letter-spacing: 0.2px;
}
.tab-btn:hover { opacity: 0.85; }
.tab-btn.active {
  opacity: 1;
  border-bottom-color: var(--accent);
}

/* Two-column form grid; children opt into full width with .field-full.
   The `field` wrapper keeps each control-and-label bundle self-contained
   so the grid spacing stays predictable. */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14px;
  row-gap: 14px;
}
.field {
  min-width: 0;
}
.field-full {
  grid-column: 1 / -1;
}

/* Uniform label + hint typography. Bumped a step from the pre-tabs
   11/11/10 scheme — with fewer fields per tab, 13px labels + 12px
   hints are the right size to read comfortably without overflowing. */
.label-tiny {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.9;
  display: block;
  margin-bottom: 5px;
  letter-spacing: 0.2px;
}

.hint-text {
  font-size: 12px;
  opacity: 0.6;
  line-height: 1.5;
  margin-top: 6px;
}

.warning-text {
  font-size: 12px;
  color: #f39c12;
  margin-top: 6px;
  line-height: 1.5;
}

.dedicated-preproxy {
  margin-top: 8px;
}

.flex-row { display: flex; gap: 10px; }
.gap-5 { gap: 5px; }

.mono-text {
  font-family: monospace;
  font-size: 12px;
}

/* Input font-size follows the label bump. Global rules set inputs to
   12px; we push to 13px inside .field for readability. */
.field input,
.field select,
.field textarea {
  margin-bottom: 0;
  font-size: 13px;
}
.field .timezone-wrapper {
  margin-bottom: 0;
}

.form-fieldset {
  border: none;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.form-fieldset[disabled] {
  opacity: 0.9;
}
.form-fieldset[disabled] input,
.form-fieldset[disabled] textarea,
.form-fieldset[disabled] select {
  cursor: not-allowed;
  background-color: rgba(255, 255, 255, 0.03);
}
.form-fieldset[disabled] button {
  cursor: not-allowed;
}

.viewonly-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 8px;
  background: rgba(76, 175, 80, 0.10);
  border: 1px solid rgba(76, 175, 80, 0.45);
  color: #a3e0a3;
}
.viewonly-icon {
  font-size: 18px;
  line-height: 1.2;
  margin-top: 1px;
}
.viewonly-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
}
.viewonly-hint {
  font-size: 12px;
  opacity: 0.9;
  line-height: 1.5;
}

.custom-ua-textarea {
  min-height: 66px;
  resize: vertical;
  width: 100%;
}
.ua-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.ua-random-btn {
  white-space: nowrap;
  padding: 4px 12px;
  font-size: 13px;
}
.ua-hint {
  margin-top: 0;
  flex: 1;
}

.profile-notes-textarea {
  min-height: 86px;
  resize: vertical;
}

.reset-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.15s, border-color 0.15s;
  margin: 0;
}
.reset-toggle:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--accent);
}
.form-fieldset[disabled] .reset-toggle {
  cursor: not-allowed;
  opacity: 0.7;
}
.reset-toggle input[type="checkbox"] {
  margin: 3px 0 0 0;
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--accent);
}
.reset-toggle-checkmark { display: none; }
.reset-toggle-body { flex: 1; min-width: 0; }
.reset-toggle-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}
.reset-toggle-body .hint-text {
  margin-top: 0;
}
.disable-spoof-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px 14px;
  margin-top: 4px;
}
.disable-spoof-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.disable-spoof-item input[type="checkbox"] {
  margin: 0;
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
