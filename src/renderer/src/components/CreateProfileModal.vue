<template>
  <div v-show="uiStore.addModalVisible" class="modal-overlay" @mousedown.self="uiStore.closeAddModal">
    <div class="modal-content">
      <div class="modal-header">
        <span>{{ $t('newProfile') }}</span>
        <span style="cursor:pointer" @click="uiStore.closeAddModal">✕</span>
      </div>
      <div class="modal-body">
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

        <!-- Basic: identity + network + screen -->
        <div v-show="activeTab === 'basic'" class="form-grid">
          <div class="field">
            <label class="label-tiny">{{ $t('profileName') }}</label>
            <input v-model="form.name" type="text" placeholder="Name" spellcheck="false" autocomplete="off">
          </div>
          <div class="field">
            <label class="label-tiny">{{ $t('tagsLabel') }}</label>
            <input v-model="form.tags" type="text" placeholder="tiktok, fb..." spellcheck="false" autocomplete="off">
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
            <textarea v-model="form.proxyStr" rows="3" placeholder="vless://, vmess://, trojan://, ss://, hysteria2://, tuic://, socks5://, ssh://... (one per line for batch)" spellcheck="false" autocomplete="off"></textarea>
            <div class="hint-text">{{ $t('batchHint') }}</div>
          </div>

          <div class="field">
            <label class="label-tiny">{{ $t('preProxySetting') }}</label>
            <select v-model="form.preProxyOverride">
              <option value="default">{{ $t('optDefault') }}</option>
              <option value="on">{{ $t('optOn') }}</option>
              <option value="off">{{ $t('optOff') }}</option>
            </select>
          </div>
          <div class="field">
            <label class="label-tiny">{{ $t('screenRes') }}</label>
            <div class="flex-row gap-5">
              <input v-model.number="form.resW" type="number" placeholder="W">
              <input v-model.number="form.resH" type="number" placeholder="H">
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

          <div class="field field-full hint-text auto-fingerprint-hint">{{ $t('autoFingerprint') }}</div>
        </div>

        <!-- Advanced: kernel + custom args + disable spoofing -->
        <div v-show="activeTab === 'advanced'" class="form-grid">
          <div class="field field-full">
            <KernelVersionSelect v-model="form.kernelVersion" />
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
            <input type="checkbox" v-model="form.headless">
            <span class="reset-toggle-checkmark"></span>
            <div class="reset-toggle-body">
              <div class="reset-toggle-title">{{ $t('headlessLabel') }}</div>
              <div class="hint-text">{{ $t('headlessHint') }}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="outline" @click="uiStore.closeAddModal">{{ $t('cancel') }}</button>
        <button :disabled="isSaving" @click="handleSave">
          {{ isSaving ? '...' : $t('generateBtn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useUIStore } from '../store/useUIStore';
import { useProfileStore } from '../store/useProfileStore';
import { getProxyRemark } from '../utils/helpers';
import KernelVersionSelect from './KernelVersionSelect.vue';
import {
  browserVersionPresetOptions,
  platformOptions,
  getOptionLabel,
  generateRandomUserAgent
} from '../utils/fingerprintOptions';

const uiStore = useUIStore();
const profileStore = useProfileStore();

const isSaving = ref(false);
const settings = ref({});
const showUaModify = ref(false);

const form = reactive({
  name: '',
  tags: '',
  notes: '',
  proxyStr: '',
  timezone: 'Auto',
  city: 'Auto (IP Based)',
  language: 'auto',
  preProxyOverride: 'default',
  resW: null,
  resH: null,
  geolocation: null,
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

// Lists (Accessing from global window if not imported)
const allTimezones = window.TIMEZONES || [];
const allCities = [AUTO_CITY, ...(window.CITY_DATA || [])];
const allLanguages = window.LANGUAGE_DATA || [
  { name: 'Auto (System Default)', code: 'auto' },
  { name: 'English (US)', code: 'en-US' }
];

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

// Global click to close dropdowns
function handleGlobalClick(e) {
  if (!e.target.closest('.timezone-wrapper')) {
    showTimezoneList.value = false;
    showCityList.value = false;
    showLanguageList.value = false;
  }
}

// Watch for modal open to reset form
watch(() => uiStore.addModalVisible, async (newVal) => {
  if (newVal) {
    activeTab.value = 'basic';
    Object.assign(form, {
      name: '',
      tags: '',
      notes: '',
      proxyStr: '',
      timezone: 'Auto',
      city: 'Auto (IP Based)',
      language: 'auto',
      preProxyOverride: 'default',
      resW: null,
      resH: null,
      geolocation: null,
      customArgs: '',
      browserVersionPreset: 'none',
      platform: 'Win32',
      customUserAgent: '',
      resetOnLaunch: false,
      kernelVersion: '',
      disabledSpoofing: [],
      headless: false
    });
    timezoneSearch.value = AUTO_TIMEZONE_LABEL;
    citySearch.value = 'Auto (IP Based)';
    languageSearch.value = 'Auto (System Default)';
    try {
      settings.value = await window.electronAPI.getSettings();
      showUaModify.value = !!(settings.value?.enableUaModify ?? settings.value?.enableUaWebglModify);
    } catch (e) {
      settings.value = {};
      showUaModify.value = false;
    }
  }
});

onMounted(() => {
  window.addEventListener('mousedown', handleGlobalClick);
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleGlobalClick);
});

async function handleSave() {
  const proxyLines = form.proxyStr.split('\n').map(l => l.trim()).filter(l => l);

  // If no proxy provided, create a single profile with Direct connection
  if (proxyLines.length === 0) {
    proxyLines.push('direct');
  }

  isSaving.value = true;
  try {
    const tags = form.tags.split(/[,，]/).map(s => s.trim()).filter(s => s);
    let createdCount = 0;

    for (let i = 0; i < proxyLines.length; i++) {
      const proxyStr = proxyLines[i];
      let name;
      if (!form.name) {
        try {
            name = proxyStr === 'direct' ? 'Direct' : (getProxyRemark(proxyStr) || `Profile-${String(i + 1).padStart(2, '0')}`);
        } catch(e) {
            name = `Profile-${String(i + 1).padStart(2, '0')}`;
        }
      } else if (proxyLines.length === 1) {
        name = form.name;
      } else {
        name = `${form.name}-${String(i + 1).padStart(2, '0')}`;
      }

      const screen = (form.resW && form.resH) ? { width: form.resW, height: form.resH } : null;
      const browserPreset = parseBrowserVersionPreset(form.browserVersionPreset);
      const trimmedUa = (form.customUserAgent || '').trim();

      const payload = {
        name,
        proxyStr,
        tags,
        notes: form.notes,
        timezone: form.timezone,
        city: form.city,
        geolocation: form.geolocation,
        language: form.language,
        screen,
        uaMode: trimmedUa ? 'spoof' : browserPreset.uaMode,
        preProxyOverride: form.preProxyOverride,
        customArgs: form.customArgs,
        browserType: browserPreset.browserType,
        browserMajorVersion: browserPreset.browserMajorVersion,
        platform: form.platform,
        userAgent: trimmedUa || undefined,
        ignoreCertErrors: true,
        resetOnLaunch: !!form.resetOnLaunch,
        kernelVersion: form.kernelVersion || null,
        disabledSpoofing: [...form.disabledSpoofing],
        headless: !!form.headless
      };
      // Strip Vue reactive proxies to avoid Electron IPC clone failures for geolocation and similar objects.
      const safePayload = JSON.parse(JSON.stringify(payload));

      await profileStore.createProfile(safePayload);
      createdCount++;
    }

    uiStore.closeAddModal();
    if (proxyLines.length > 1) {
      uiStore.showAlert(`Batch created successfully: ${createdCount}`);
    }
  } catch (err) {
    console.error('Create profile failed:', err);
    uiStore.showAlert("Create Failed: " + err.message);
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.modal-content {
  width: min(720px, 92vw);
}

/* See EditProfileModal for the same block — kept in sync intentionally
   because Vue scoped styles don't cross the two components. */
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

.flex-row { display: flex; gap: 10px; }
.gap-5 { gap: 5px; }

.mono-text {
  font-family: monospace;
  font-size: 12px;
}

.field input,
.field select,
.field textarea {
  margin-bottom: 0;
  font-size: 13px;
}
.field .timezone-wrapper {
  margin-bottom: 0;
}

.profile-notes-textarea {
  min-height: 86px;
  resize: vertical;
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

/* "Fingerprint auto-generated" tip: reserve a visual gap above so it
   doesn't hug the kernel select above it. */
.auto-fingerprint-hint {
  margin-top: 0;
  text-align: center;
  opacity: 0.5;
}
</style>
