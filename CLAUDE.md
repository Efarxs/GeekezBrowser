# CLAUDE.md — GeekEZ Browser 项目手册

> 这份文件是给未来 Claude session 用的快速上手 + 避坑清单。
> 项目背景、用户画像已经在 memory 里（[[project-purpose]]、[[fingerprint-chromium-flags]]），不重复。
> 当前版本：**1.7.14** · 主分支：`main` · 开发分支：`dev`（PR 汇合点）· feat 分支从 dev 拉

---

## 架构一览

Electron 应用，标准三层：

- **主进程** `src/main/index.js`（**6500+ 行**，是本仓的中心）——45 个 `ipcMain.handle` + 一个内嵌 HTTP API server（默认 `127.0.0.1:12138`）
- **预加载** `src/preload/index.js` —— `contextBridge` 暴露 `window.electronAPI`
- **渲染进程** `src/renderer/`（Vue 3 + Pinia，22 个组件，pageSize 分页）

数据存储：**SQLite（drizzle-orm + better-sqlite3）** —— `%APPDATA%/geekez-browser/BrowserProfiles/profiles.db`

浏览器内核：**fingerprint-chromium**（第三方 fork）—— PINNED 是 `148.0.7778.215`，用户可 per-profile 指定其他版本（148/144/142/139/138），首次启动按需下载到 `%APPDATA%/geekez-browser/BrowserProfiles/kernels/<version>/`

网络栈：**sing-box**（Go 二进制，`resources/bin/singbox-*`）—— profile 启动时 spawn 一个 sing-box 进程，绑定本地 socks5 端口，Chrome 用 `--proxy-server=socks5://127.0.0.1:<port>` 走过去

---

## 常用命令 + 已知坑

| 命令 | 说明 | 坑 |
|---|---|---|
| `npm run dev` | electron-vite dev + electron 主进程 | 需要 15173（vite）和 12138（API）**都空闲**；有 `predev` 自动 rebuild native |
| `npm run build:win` | 打 Windows 包（含 x64 + arm64） | 有 `prebuild:win` 自动杀 electron.exe（否则 `.node` 文件被锁 `EPERM`）；有 `postbuild:win` 自动 rebuild 回本机 ABI 给 dev 用 |
| `npm test` | 15 个单测（`node --test`） | 只测 `src/main/kernel-versions.js`（纯 CJS）—— `fingerprint.js` 是 Vite hybrid（见下） |
| `npm run test:api` | 23 个黑盒 API 测试（`scripts/api-smoke.mjs`） | **需要 dev 已启动**；用 socks5://127.0.0.1:7890 做测试代理 |

**还有个** `scripts/api-smoke-v2.mjs`（17 assertions，覆盖 v1.7.13 新增的 kernels / settings / duplicate / runtime / clean / keepProxy / proxy latency）；同样需要 dev 跑着。

---

## 会踩的坑（从血泪教训里提炼）

### 1. `better-sqlite3` ABI mismatch

`npm run build:win` 会用 electron-builder 重编 native module 为**打包目标 Electron ABI**（`x64` + `arm64` 两遍）。最后 arm64 那次会覆盖 `.node` 文件，本机 x64 dev 起不来，报"不是有效的 Win32 应用"。

**已经有防御**：
- `predev` 钩子（`scripts/ensure-native-abi.mjs`）—— dev 前用 `require()` 探测 ABI，坏了就 `@electron/rebuild -f -w better-sqlite3`
- `postbuild:win` 钩子 —— 打完包立刻恢复 dev 用的 x64 版本

如果你**手动**跑了 `npx electron-builder`（绕开 npm script）就会中招 —— 手动跑 `npm run postbuild:win` 或直接 `npx @electron/rebuild -f -w better-sqlite3`。

### 2. `src/main/fingerprint.js` 是 Vite 混合模块

顶部用 `require`（CJS），底部用 `export {}`（ESM）。**Vite 能吃**、**Node 不能直接 `require`**。想单测里面的函数？三条路：

- **推荐**：抽到 `src/main/kernel-versions.js`（纯 CJS）再单测（`pickFullVersionForMajor`、`buildBrowserBrands` 就是这么做的）
- 用 `vitest` 或类似支持 Vite 转换的 runner —— 但当前项目没引，别为一个测试引一整套
- 别单测大型函数，`generateFingerprint` 由 `scripts/api-smoke.mjs` 端到端覆盖

### 3. 端口占用（`EADDRINUSE`）

- **15173** —— vite dev server；`npm run dev` 崩了没完全释放很常见
- **12138** —— 内嵌 API server；user 装的 release 版和 dev 版会**互抢**这个端口，测试前记得确认在跟哪个说话
- **24000-65000** —— CDP debug port pool；见下

**杀端口占用者**（Windows）：
```powershell
try { $c=Get-NetTCPConnection -LocalPort 15173 -ErrorAction Stop; Stop-Process -Id $c.OwningProcess -Force } catch {}
```

### 4. CDP debug port 分配语义（v1.7.13+）

- 首次分配：**从 24000 顺序填空洞**（用手写走查而不是 `get-port`，因为后者有 15s `lockedPorts` 缓存拒绝立即复用）
- 持久化：写到 `profile.debugPort`，同 profile 永远同端口
- Launch 时如果持久端口**被 OS 上其他程序抢了**：本次分配一个动态端口（`get-port` + `makeRange` + `exclude: [...dbUsed]`），进 `reservedPorts`，profile 退出时释放。**`profile.debugPort` 不动**，下次继续试原端口
- **API `/api/open` 响应里 `"remote port"` 是本次实际绑定的端口**，不是 `profile.debugPort`。脚本一律按响应读，别 hardcode DB 值

### 5. sing-box 启动 3 阶段重试

`waitForProxyChainReady` 分 fast → slow → extended：

- **fast**（2.2-2.6s）→ 失败且 `shouldRetryProxyProbe` 判为 warmup-like → slow
- **slow**（4-5.5s，probe timeout 3-3.5s）→ 失败且仍是 warmup-like → extended
- **extended**（6-12s，probe timeout 4-5s）—— 只在两级都是 warmup-like 时才启

**"hard errors"（不重试）**：`ENETUNREACH` / `EHOSTUNREACH` / `ERR_SSL` / `HTTP 4xx`。**`ECONNRESET` / `ECONNREFUSED` / `HTTP 5xx` 都是 warmup-like**（sing-box 首波握手 race，之前被误判为 hard 导致大量误报）

### 6. `/api/open` 层还有 `?verify=browser`

sing-box probe 通不代表 Chrome 一定能用（约 2-5% 概率）。可选参数会在 launch 完之后用 CDP `Page.navigate` 打一次 `https://www.gstatic.com/generate_204`（可覆盖），等 top-level `Network.responseReceived`（**不是 `Page.loadEventFired`**，204 空 body 有些 Chrome 版本不触发 load）才算通。失败会 auto-stop profile 并返回 500。

需要"设置 → 远程调试"开着。响应加 `+2-10s`。

### 7. 每处 `profileDB.getAll()` 都是潜在 100K 悬崖

100K profile × ~5KB fingerprint JSON = **~500MB** 一次全表加载。CRUD 路径（`save-profile` / `update-profile` / `POST/PUT /api/profiles` / `launchProfileHandler`）已经在 v1.7.12 时改成 `profileDB.nameExists()` + `profileDB.getById()` + `profileDB.getUsedDebugPorts()`。

**新加代码时别再引入 `profileDB.getAll()`**，除非真的需要全量（导出/备份/tray-menu）。工具函数（如 `buildUniqueProfileName`）都接受 async 谓词 callback，不是 array。

### 8. `preProxyOverride` 走的是 App 内配置，不是系统代理

profile 的 `preProxyOverride: 'on'` 强制走链，但**链上用的是 Settings 里配置的 preProxies**（`settings.preProxies[]` 里 `enable: true` 的那些）—— **不会自动用系统 Clash / v2ray**，除非用户手动把 `socks5://127.0.0.1:7890` 加进 Settings → 代理链。App 不知道 Clash 存在。

选谁按 `settings.mode`：`single`（选 `selectedId`）/ `balance`（随机）/ `failover`（第一个 enable 的）。

### 9. LF/CRLF 警告是良性的

Windows 下 git 会警告：
```
warning: in the working copy of 'x.vue', LF will be replaced by CRLF the next time Git touches it
```
**不用管**，`.gitattributes` 没设、`autocrlf` 生效。不影响功能。

### 10. Kernel IPC 桥抽出去了

7 个 `kernel:*` handler 不在 `src/main/index.js` 里，在 `src/main/kernel/ipc-bridge.js`。index.js 只留一行 `registerKernelIpc({ profileDB, getActiveProcesses: () => activeProcesses })`。launch flow 里读 in-flight install 用 `getActiveInstall()`（不是访问局部变量）。

---

## 一眼速查表

| 我想找... | 去这里 |
|---|---|
| 某个 IPC handler | `grep "ipcMain.handle('<name>'" src/main/index.js` |
| 某个 HTTP endpoint | `src/main/index.js` 的 `handleApiRequest`（1900+ 行左右） |
| 指纹字段允许列表 | `src/main/index.js` 的 `normalizeFingerprintOptions` |
| Chrome patch 池 / brand 构造 | `src/main/kernel-versions.js`（CJS，可直接 require + 测） |
| sing-box config 生成 | `src/main/utils.js:generateSingBoxConfig` |
| profile DB 查询 | `src/main/profile-db.js`（有 `nameExists / getUsedDebugPorts / getPaged`；**不要**乱用 `getAll`） |
| 代理链探测逻辑 | `src/main/index.js:waitForProxyChainReady` |
| 内核安装/卸载 | `src/main/kernel/manager.js`（纯逻辑）+ `src/main/kernel/ipc-bridge.js`（IPC 层） |
| 启动错误 UI | `src/renderer/src/components/LaunchErrorModal.vue` + `useUIStore` 的 `showLaunchError` |
| profile 编辑表单 | `src/renderer/src/components/EditProfileModal.vue`（3 tabs：基础/指纹/高级） |

---

## 测试策略

- **单测**（`node --test`）：只在**纯 CJS + 无 Electron 依赖**的模块加。目前只有 `kernel-versions.test.mjs`（15 assertions：pool 完整性、`pickFullVersionForMajor` 各种输入、`buildBrowserBrands` 品牌/顺序不变量）。想加新单测 → 先把目标函数抽到 CJS 模块
- **API 黑盒**：`scripts/api-smoke.mjs`（23）+ `api-smoke-v2.mjs`（17）——**需要 dev 跑着**。改 API 契约必须两边都过。写新 endpoint 时同步补 test case
- **E2E 手动**：没有 Playwright/CDP 自动化。UI 改动要**真起 dev 用一下**（tabs 里的 tap，检查 CDP port chip 等）
- **网络能力**：真机测试代理相关变更用 `scripts/test-1024proxy-chain.mjs`（需要用户 Settings 里配置好的 preProxies）

**测试代理**：`socks5://127.0.0.1:7890`（用户机器上跑的 Clash）—— smoke 脚本硬编码了这个

---

## API 契约稳定性

`docs/api/API.md` 是**用户脚本作者依赖的合同**。每次改 API 必须同步更新：

- 版本头（顶部 `> 适用版本：v1.7.x`）
- 接口一览表（第二章）
- 详细章节 + `curl` 示例
- 版本号在 `package.json` 也要 bump

**已有先例**：v1.7.12 加 `disabledSpoofing` / `kernelVersion` 字段、v1.7.13 加 duplicate/runtime/kernels/settings 等 7 个新 endpoint、v1.7.14 加 `?verify=browser` + chain-aware latency。每次都跟随 semver patch bump + 完整 doc 更新。

**破坏性变更**：**避免**。用可选参数 + 默认关（如 `?verify=browser` / `?clean=true` / `?keepProxy=true`）扩展。

---

## Git 工作流

- feat 分支从 `dev` 拉：`feat/<slug>`
- 完成后 → `git checkout dev && git merge feat/<slug> --ff-only && git push origin dev`
- **不动 `main`**，那是 release 分支，别人管
- 用户经常说"推送" —— 就是 `git push origin dev`

**Commit 格式**：`type(scope?): 简述` + 详细 body。body 里说清楚 **why + 边界情况 + 测试结果**（比如 "verified: 15/15 unit, 23/23 smoke"）—— 参考最近几个 commit 的风格

---

## Windows 特有的坑（补充）

- `taskkill /F /IM electron.exe /T` 在 UTF-8 shell 里输出乱码 —— 用 PowerShell 的 `Get-Process | Stop-Process` 更干净
- `spawn('.cmd', { shell: false })` 会 `EINVAL`。必须 `shell: true`（见 `scripts/ensure-native-abi.mjs`）
- `path.join` 的斜杠对 Windows 无所谓，但 hardcoded `/` 的字符串（比如 URL 拼接）在 Node.js 里都用 `/`，注意区分
- `.node` 原生模块被 electron 进程锁着时不能删/覆盖 → 见坑 #1

---

## Skip 掉的开发方向（历史决议）

- **单元测试大规模覆盖**：Electron 应用里核心逻辑要么 IPC glue、要么浏览器进程编排 —— 单测成本高、假设脆弱、跟真实 Chrome 行为脱钩。**黑盒 smoke 更合适**
- **拆分 `useUIStore.js`**：state 多但不复杂，拆完只是文件多了几个 import
- **重构 `src/main/index.js`（6500 行）**：只在**明显自足的簇**能抽出去时才做（kernel IPC 就是这么走的）。整体大重构没意义
- **CHANGELOG.md**：不写，用 git log + API.md 的版本头就够了
- **Cookie 单独 API 端点**：全量加密备份已经覆盖，不加

---

## 未来审计要点（下一位 Claude 接手时值得看的）

- CRUD 路径里的 `profileDB.getAll()` 有没有回归（100K 悬崖）
- `sing-box` 相关 3 阶段 probe 的 timeout 值：现网有变化时可能需要重新校准（当前值来自 1024proxy 真实测试）
- CDP debug port 池：24000-65000 = 41K 上限。用户如果给全部 100K profile 开远程调试会耗尽（会明确报错，不会静默 fallback）
- `fingerprint-chromium` 新版本发布时：`BROWSER_FULL_VERSION_POOL` 需要人工加新补丁号（`src/main/kernel-versions.js`）
- Chrome 大版本 major bump 时：`mapBrowserMajorToUtls`（`fingerprint.js`）里的 uTLS 映射规则需要复核
