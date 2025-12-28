# GeekEZ Browser v1.3.1 更新说明

## 🎯 指纹增强版本

本次更新专注于提升指纹隐蔽性，确保通过主流指纹检测网站的所有检测项。

---

## ✨ 新功能

### 屏幕分辨率伪装
- 添加了隐蔽的 `screen.width`, `screen.height`, `screen.availWidth`, `screen.availHeight` Hook
- 自定义分辨率现在会反映在指纹检测中（之前只改变窗口大小）
- 使用 `makeNative` 包装避免被检测为伪装

### 硬件指纹伪装
- **CPU 核心数**: 每个环境随机生成 [4, 8, 12, 16] 中的值
- **设备内存**: 每个环境随机生成 [2, 4, 8] GB 中的值
- 两个 Hook 均使用隐蔽模式修改 `Navigator.prototype`

### 跨平台时区支持
- **Windows**: 使用 JavaScript Hook（TZ 环境变量在 Windows 上不生效）
- **macOS/Linux**: 使用原生 TZ 环境变量
- 自动平台检测，确保每个操作系统使用最优方案

### 界面优化
- 新建环境弹窗增加了**地理位置**和**语言**选择器
- 编辑环境弹窗移除了 **Seed** 输入框（不建议手动修改）
- 移除了时区警告提示

---

## 🐛 问题修复

- 修复 `deviceMemory` 被检测问题（使用有效值 2, 4, 8 替代 4, 8, 16）
- 修复 "Auto" 语言设置时的语言泄露问题 - 现在正确 Hook Intl API
- 修复 macOS 上因 Hook 缺少 `makeNative` 包装导致的伪装检测
- 修复 Apple Silicon Mac 上 ARM 与 Intel 架构不匹配的检测问题

---

## 🔧 技术改进

- 所有 Hook 现在使用 `makeNative` 模式实现隐蔽
- Hook 应用于原型对象而非实例
- 语言解析在扩展生成之前完成，确保一致性

---

## ✅ 兼容性

| 平台 | 状态 |
|------|------|
| Windows x64 | ✅ 完全支持 |
| macOS Intel | ✅ 完全支持 |
| macOS Apple Silicon | ✅ 完全支持 |

### 已测试检测网站
- ✅ Pixelscan.net - 全部通过
- ✅ Browserscan.net - 全部通过
- ✅ Cloudflare - 验证通过

---

## 📦 下载

- **Windows**: `GeekEZBrowser-1.3.1-win-x64.exe`
- **macOS Intel**: `GeekEZBrowser-1.3.1-mac-x64.dmg`
- **macOS Apple Silicon**: `GeekEZBrowser-1.3.1-mac-arm64.dmg`
