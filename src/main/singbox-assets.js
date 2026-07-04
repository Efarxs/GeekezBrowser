function parseArmVersion(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectArmVersion({ env = process.env, processConfig = process.config } = {}) {
    return parseArmVersion(
        env.npm_config_arm_version ||
        env.NPM_CONFIG_ARM_VERSION ||
        processConfig?.variables?.arm_version
    );
}

function resolveLinuxSingBoxArch({ arch, armVersion = detectArmVersion() } = {}) {
    if (arch === 'x64') return 'amd64';
    if (arch === 'ia32') return '386';
    if (arch === 'arm64') return 'arm64';
    if (arch === 'arm') {
        if (armVersion === 5) return 'armv5';
        if (armVersion === 6) return 'armv6';
        return 'armv7';
    }
    return null;
}

/**
 * Resolve sing-box release asset for the current platform.
 * Returns { asset, ext, innerDir, execName } or null when the platform is unsupported.
 *
 * `innerDir` is the top-level folder embedded inside the archive; the sing-box
 * executable sits at `<archive>/<innerDir>/<execName>`. The archive naming is:
 *
 *   sing-box-<version>-<os>-<arch>.<ext>
 *
 * with ext = zip on Windows, tar.gz elsewhere.
 */
function resolveSingBoxAssetName({
    platform = process.platform,
    arch = process.arch,
    armVersion,
    version
} = {}) {
    if (!version) return null;

    let os;
    let ext;
    let execName;

    if (platform === 'win32') {
        os = 'windows';
        ext = 'zip';
        execName = 'sing-box.exe';
    } else if (platform === 'darwin') {
        os = 'darwin';
        ext = 'tar.gz';
        execName = 'sing-box';
    } else if (platform === 'linux') {
        os = 'linux';
        ext = 'tar.gz';
        execName = 'sing-box';
    } else {
        return null;
    }

    let goArch;
    if (platform === 'win32' || platform === 'darwin') {
        if (arch === 'x64') goArch = 'amd64';
        else if (arch === 'arm64') goArch = 'arm64';
        else if (platform === 'win32' && arch === 'ia32') goArch = '386';
        else return null;
    } else {
        goArch = resolveLinuxSingBoxArch({ arch, armVersion });
        if (!goArch) return null;
    }

    const stem = `sing-box-${version}-${os}-${goArch}`;
    return {
        asset: `${stem}.${ext}`,
        ext,
        innerDir: stem,
        execName
    };
}

module.exports = {
    detectArmVersion,
    resolveLinuxSingBoxArch,
    resolveSingBoxAssetName
};
