function makeOption(value, label, labelZh = '') {
    return { value, label, labelZh: labelZh || label };
}

export const browserTypeOptions = [
    makeOption('auto', 'Auto Random', '自动随机'),
    makeOption('chrome', 'Google Chrome', 'Google Chrome'),
    makeOption('edge', 'Microsoft Edge', 'Microsoft Edge')
];

export const browserMajorVersionOptions = [
    makeOption('auto', 'Auto Random', '自动随机'),
    makeOption(148, 'v148', 'v148')
];

export const browserVersionPresetOptions = [
    makeOption('none', 'No UA Modification', '不修改 UA'),
    makeOption('auto', 'Auto Random', '自动随机'),
    makeOption('chrome:148', 'Chrome v148', 'Chrome v148'),
    makeOption('edge:148', 'Edge v148', 'Edge v148')
];

export const tlsClientHelloOptions = [
    makeOption('auto', 'Auto (Map by Browser Version)', '自动（按浏览器版本映射）'),
    makeOption('chrome', 'Chrome uTLS', 'Chrome 指纹'),
    makeOption('edge', 'Edge uTLS', 'Edge 指纹'),
    makeOption('firefox', 'Firefox uTLS', 'Firefox 指纹'),
    makeOption('safari', 'Safari uTLS', 'Safari 指纹'),
    makeOption('ios', 'iOS Safari uTLS', 'iOS Safari 指纹'),
    makeOption('android', 'Android uTLS', 'Android 指纹'),
    makeOption('qq', 'QQ uTLS', 'QQ 指纹'),
    makeOption('360', '360 uTLS', '360 指纹'),
    makeOption('random', 'Random uTLS', '随机指纹'),
    makeOption('randomized', 'Randomized uTLS', '随机化指纹'),
    makeOption('hellorandomizednoalpn', 'Randomized (No ALPN)', '随机化（无 ALPN）')
];

export function getOptionLabel(option) {
    if (!option) return '';
    if (window.curLang === 'cn') return option.labelZh || option.label;
    return option.label;
}

const KERNEL_CHROME_MAJOR = 148;

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildRandomFullVersion(major) {
    // Chrome full version format: MAJOR.0.<build>.<patch>
    const build = randInt(7500, 7999);
    const patch = randInt(50, 300);
    return `${major}.0.${build}.${patch}`;
}

const PLATFORM_UA_TOKEN = {
    Win32: 'Windows NT 10.0; Win64; x64',
    MacIntel: 'Macintosh; Intel Mac OS X 10_15_7',
    'Linux x86_64': 'X11; Linux x86_64'
};

export function generateRandomUserAgent({ platform = 'Win32', browserType = 'chrome', major = KERNEL_CHROME_MAJOR } = {}) {
    const token = PLATFORM_UA_TOKEN[platform] || PLATFORM_UA_TOKEN.Win32;
    const fullVersion = buildRandomFullVersion(major);
    const base = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVersion} Safari/537.36`;
    return browserType === 'edge' ? `${base} Edg/${fullVersion}` : base;
}
