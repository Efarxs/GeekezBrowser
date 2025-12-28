# GeekEZ Browser v1.3.1 Release Notes

## 🎯 Fingerprint Enhancement Release

This release focuses on improving fingerprint stealth and bypassing detection on major fingerprint checking sites.

---

## ✨ New Features

### Screen Resolution Spoofing
- Added stealthy `screen.width`, `screen.height`, `screen.availWidth`, `screen.availHeight` hooks
- Custom resolution now reflects in fingerprint detection (previously only changed window size)
- Uses `makeNative` wrapper to avoid masking detection

### Hardware Fingerprint Spoofing
- **CPU Cores**: Random values from [4, 8, 12, 16] per profile
- **Device Memory**: Random values from [2, 4, 8] GB per profile
- Both hooks use stealth pattern on `Navigator.prototype`

### Cross-Platform Timezone Support
- **Windows**: Uses JavaScript hooks (TZ environment variable doesn't work on Windows)
- **macOS/Linux**: Uses native TZ environment variable
- Automatic platform detection ensures optimal method for each OS

### UI Improvements
- Added **Location** and **Language** selectors to new profile creation modal
- Removed **Seed** input from edit modal (not intended for manual modification)
- Removed timezone warning from UI

---

## 🐛 Bug Fixes

- Fixed `deviceMemory` detection by using valid values (2, 4, 8 instead of 4, 8, 16)
- Fixed language leak when using "Auto" setting - now properly hooks Intl API
- Fixed masking detection on macOS caused by hooks without `makeNative` wrapper
- Fixed ARM vs Intel architecture mismatch detection on Apple Silicon Macs

---

## 🔧 Technical Changes

- All hooks now use `makeNative` pattern for stealth
- Hooks are applied to prototype objects instead of instances
- Language resolution happens before extension generation to ensure consistency

---

## ✅ Compatibility

| Platform | Status |
|----------|--------|
| Windows x64 | ✅ Full Support |
| macOS Intel | ✅ Full Support |
| macOS Apple Silicon | ✅ Full Support |

### Tested Detection Sites
- ✅ Pixelscan.net - All checks passed
- ✅ Browserscan.net - All checks passed
- ✅ Cloudflare - Passes verification

---

## 📦 Download

- **Windows**: `GeekEZBrowser-1.3.1-win-x64.exe`
- **macOS Intel**: `GeekEZBrowser-1.3.1-mac-x64.dmg`
- **macOS Apple Silicon**: `GeekEZBrowser-1.3.1-mac-arm64.dmg`
