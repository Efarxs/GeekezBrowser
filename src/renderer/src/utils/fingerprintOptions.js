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
    ...Array.from({ length: 19 }, (_, i) => {
        const major = 147 - i;
        return makeOption(major, `v${major}`, `v${major}`);
    })
];

export const browserVersionPresetOptions = [
    makeOption('none', 'No UA Modification', '不修改 UA'),
    makeOption('auto', 'Auto Random', '自动随机'),
    ...Array.from({ length: 19 }, (_, i) => {
        const major = 147 - i;
        return [
            makeOption(`chrome:${major}`, `Chrome v${major}`, `Chrome v${major}`),
            makeOption(`edge:${major}`, `Edge v${major}`, `Edge v${major}`)
        ];
    }).flat()
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
