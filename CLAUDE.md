# CLAUDE.md — GeekEZ Browser 项目手册

> 这份文件是给未来 Claude session 用的快速上手 + 避坑清单。
> 项目背景、用户画像已经在 memory 里（[[project-purpose]]、[[fingerprint-chromium-flags]]），不重复。
> 当前版本：**1.7.20** · 主分支：`main` · 开发分支：`dev`（PR 汇合点）· feat 分支从 dev 拉

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

### 11. Launch flow 里"提前捕获 override flag"是反模式（v1.7.17 修复的坑）

历史 bug：`--lang` / `--accept-lang` 的推送 gate 是**一次性 const**（`hasLanguageOverride = language !== 'auto'`），在 Auto-IP-base pass **之前**算好。当 `language: 'auto'` 时，gate 永远是 false — 即使 Auto-IP-base 之后把 `profile.fingerprint.language` 更新成了 `en-US`，`--lang` 也不会被推给 Chrome。Chrome fallback 到宿主 locale，US 代理的 profile 泄漏 `zh-CN`。

正确模式（timezone / geolocation 一直是这么写的）：**每次读当前值**：

```js
// ❌ 反模式
const hasOverride = fp.language !== 'auto';
// ... Auto-IP-base 跑，可能改 fp.language ...
if (hasOverride) launchArgs.push(`--lang=${fp.language}`);   // 用了过期的 gate

// ✅ 对的写法
// ... Auto-IP-base 跑 ...
const finalLang = fp.language;
if (finalLang && finalLang !== 'auto') launchArgs.push(`--lang=${finalLang}`);
```

**规则**：Auto-IP-base pass（`resolveAutoIpBaseFingerprintAfterLaunch`，其实是 spawn 之前跑的）会 in-memory 更新 `fingerprint.language` / `timezone` / `geolocation` / `city`。任何依赖这些字段的 flag 推送都必须**在 pass 之后**读当前值，不能提前算一个"要不要推"的 const。回归测试在 `scripts/api-smoke-v2.mjs` 里的 language-Auto CDP 检查（`navigator.language === 'fr-FR'` 断言）会兜住这一点。

### 12. `profile.headless` 是顶层 boolean（不在 fingerprint 内）

v1.7.17 加的字段，跟 `resetOnLaunch` / `ignoreCertErrors` 同层，不是 `fingerprint` 子对象里的。启动时 gate `if (profile.headless)` 会追加：

- `--headless=new`（`--headless=old` 上游 Chrome 132 已删）
- `--disable-blink-features=AutomationControlled`（屏蔽 `navigator.webdriver`）
- 若 `effectiveUa` 空则用平台+kernel major 合成一段 Chrome UA（避免 `HeadlessChrome/…` 后缀）

Duplicate flow 走 `...source` 自动带过来。DB schema 三套（sqlite/pg/mysql）都有 ALTER TABLE 迁移。UI 复选框在 Create/Edit 两个 modal 的 Advanced tab。**不要**当作 fingerprint 字段 —— 反欺诈可能靠"UA 是不是无头"来判定，但 UA 本身不是"想不想开无头"的元数据，两者分层。

### 13. `profile.preProxyStr` —— per-profile 内联前置代理（v1.7.18）

顶层 string（跟 `preProxyOverride` 并列，不在 fingerprint 内）。非空时，本 profile 在主代理之前先经过这个上游，**绕开全局 `settings.preProxies` 池 + `mode`**。

启动 flow（`index.js:5575` 附近）的选择优先级，**必须三处保持一致**（launch flow / `/api/proxy/latency` / 任何新读代理链的地方）：

1. `preProxyOverride === 'off'` → 绝对 kill-switch，永不走链（**赢过 `preProxyStr`**）
2. `preProxyStr` 非空 → 用它，`activePreProxy = { url, remark:'profile' }`，**隐含 `on`**（不需要全局 `enablePreProxy` 开关）
3. 否则 → 老的全局池逻辑（single/balance/failover）

关键不变量：**非空 `preProxyStr` 隐含"要走链"**——别再写"提前算 `hasOverride` const"那种反模式（见坑 #11）。格式不校验（跟 `proxyStr` 一样存原样），非法/不可达由 `startPreProxyHealthCheck` + sing-box parse 在启动时兜错，不静默裸奔。Duplicate `...source` 自带；三套 DB schema 都有 ALTER TABLE 迁移；回归测试在 `api-smoke-v2.mjs`（round-trip + duplicate + `chain.preProxy==='profile'`）。

**主代理直连 + 内联前置**：`useDirectNetwork` 路径（`index.js:5677` 附近）会把前置当唯一出口，仍 spawn sing-box —— 内联前置在这条路径也生效。

### 14. 前置代理的 UI 是"单选式"（v1.7.19，映射到 override + preProxyStr）

Create/Edit modal 里前置代理是**一个 4 选一下拉**（不是 override 下拉 + preProxyStr 输入框两件套），选项：`global`（跟随全局）/ `pool`（强制用全局池）/ `dedicated`（本环境专属 URL，展开输入框）/ `off`（强制关）。组件里用一个 `preProxyMode` ref：

- **载入**：`derivePreProxyMode(override, preProxyStr)` —— off 最优先，其次非空 preProxyStr→dedicated，其次 on→pool，否则 global。
- **保存**：反向映射回 `(preProxyOverride, preProxyStr)` —— global→`default/''`、pool→`on/''`、dedicated→`default/url`、off→`off/''`。

**后端契约没变**（还是 override + preProxyStr 两个字段，坑 #13 的优先级不变）。改动只在两个 modal 的 template + script。卡片上**不再**能改前置代理（原来的 quickUpdatePreProxy 快捷下拉已删），改成只读 tag（`ProfileCard.vue` 的 `preProxyTag` computed，仅非-default 时显示）。

`ProfileCard.vue` 的 `displayProto`：无主代理时显示 `DIRECT`（不是 `N/A`）；但**若配了 dedicated `preProxyStr` 且非 off，前置即出口**，显示前置的协议而非 DIRECT。

### 15. 运行态 UI：Stop 按钮 + 每次启动随机边框色

**Stop 按钮**（v1.7.19）：以前 UI 没有停止运行中 profile 的入口（只能关窗口或走 HTTP `/stop`）。现在 `ipcMain.handle('stop-profile')` 包了跟 HTTP `/stop` 同一条 `cleanupProfileRuntime({closeBrowser:true, killProxy:true, broadcast:true})`。停止后 `broadcastProfileStatus(id,'stopped')` → 渲染进程 `App.vue` 的 `profile-status` 监听把 id 从 `runningIds` 里摘掉 → 卡片按钮从 Stop 自动切回 Launch。运行时卡片的 ▾ launch-more 菜单**整体隐藏**（里面全是需先停止的操作）。

**随机边框色**（v1.7.19，由设置 `enableInstanceColor` 开关控制，**默认开**，与水印无关）：每次启动生成随机色 `randomFrameColor()`（HSL→RGB），launch flow 追加 `--install-autogenerated-theme=R,G,B`（浏览器外壳级，页面 JS 读不到，**不加指纹面**），hex 存到 `activeProcesses[id].frameColor` 并通过 `broadcastProfileStatus(id,'running',color)` **广播给所有窗口**（不是 `event.sender`——API 启动时 sender 是 HTTP 响应而非渲染进程，用 sender 会导致 API 启动的卡片边框不同步）+ `get-profile-runtime-state` 的 `frameColors` 返回；`useProfileStore.frameColors` 存，`ProfileCard` 边框/box-shadow 同色。**每次启动随机、不持久化**；关掉设置则用 Chrome 默认主题。坑：别把它 gate 在 `!enableWatermark` 上（曾经这么写，导致"水印开着就没色"+"API 有色 UI 没色"的错觉）。商业指纹浏览器的"导航栏/图标显示环境名"需要自建 Chromium，本项目用 pinned 第三方 fingerprint-chromium 二进制，做不了那条路 —— 边框色是外壳级里唯一低成本且指纹安全的方案。

**停止的假崩溃提示坑**：`cleanupProfileRuntime` 的完整拆除分支会 `delete activeProcesses[id]`，但**必须在"即将 forceKill 活着的 browserPid"时保留 `userStopRequested` 标记**——浏览器 `exit` 事件是异步的、在此函数之后才触发，它靠这个标记判定 `wasUserInitiated` 来抑制"浏览器异常退出"toast，并自己消费/删除标记。只有"浏览器已经死了、没有 pid 可杀"时才在这里删标记（避免残留误伤下次真崩溃）。这个坑同时影响 HTTP `/stop` 和卡片 Stop 按钮。

### 16. 托盘图标"运行久了会丢" —— Windows 通知区重建，必须主动重建 Tray（v1.7.19）

`createTray()` 只在启动调一次（`index.js` `whenReady`）。Windows 会在 **explorer 重启 / Windows Update / DPI·显示器变化 / 睡眠唤醒 / 锁屏解锁**时**整个重建通知区**，要求程序重新登记图标；不重加图标就消失、直到重启 App。**致命陷阱：这种情况下 `appTray.isDestroyed()` 仍返回 `false`**（Electron 还持有对象，只是 OS 那侧图标没了），所以任何"检查 isDestroyed 再补"的健康检查都查不出来——**只能主动重建**。

修法：`registerTrayResilience()` 在相关事件上 `destroy()` 旧 tray + `createTray()` 重建（800ms 防抖）：`powerMonitor` 的 `resume`/`unlock-screen`（长会话最常见诱因）+ `screen` 的 `display-metrics-changed`/`display-added`/`display-removed`。未覆盖"explorer 崩溃且不伴随上述事件"——如仍偶发，加一条主窗口 `focus` 防抖重建兜底。

**打包版还要补图标**：`build.files` 只含 `out/**`，`extraResources` 原来只拷 `bin`+`doc`，所以 `resources/logo.ico`/`icon.ico` 在打包后**不存在**，`resolveTrayIconImage` 只能退回 `app.getFileIcon(execPath)`/SVG 方块。已加 `extraResources` 把 `logo.ico/icon.ico/logo.svg` 拷到 `resourcesPath`（该函数已探测这些路径）。另注：**Windows 上 `nativeImage.createFromPath('*.svg')` 不栅格化 SVG**（返回空被跳过），所以真正生效的是 `.ico`；SVG 只在 dataURL 兜底那处用。

### 17. `resetOnLaunch` 的 `carryOver` 白名单会静默丢掉任何没列进去的 fingerprint 字段（v1.7.20 修复的坑）

历史 bug：`resetOnLaunch=true` 的 profile 每次启动会 `profile.fingerprint = generateFingerprint(carryOver)` **整体重建**指纹对象。`carryOver`（`index.js:5619` 附近）是一份**显式白名单**——只列了要跨重掷保留的用户字段（timezone / city / geolocation / language / platform / screen / hardwareConcurrency / deviceMemory / userAgent…）。**任何没写进白名单的字段，重掷后一律丢失**；而且 `generateFingerprint`（`fingerprint.js:670`）返回的对象是**硬编码字段集**，不会透传 `options` 里的额外字段。

踩过的雷：`disabledSpoofing`（用户在 UI 勾的"关闭 GPU/canvas/... 伪装"）没进白名单 → 存进 DB 的 `["gpu"]` 在启动瞬间被丢 → launch flow（`index.js:6413`）读到空 → `--disable-spoofing=gpu` **根本没推**。表象极具迷惑性：**UI 勾选无效，但把等价的 `--disable-spoofing=gpu` 手写进自定义参数却生效**——因为 customArgs 走的是 `profile.customArgs` 路径（`index.js:6529`），重掷根本不碰它。

**规则**：任何新增的、代表**用户意图**（而非可重掷噪声种子）的 fingerprint 字段，必须**同时**：(1) 加进 `carryOver` 白名单；(2) 在 `generateFingerprint` 的返回对象里透传出来（`disabledSpoofing` 现在是 `if (Array.isArray(options.disabledSpoofing)) fingerprint.disabledSpoofing = [...]`）。噪声类字段（canvasNoise / audioNoise / noiseSeed）则**故意**不保留、每次重掷。回归验证：勾"关闭 GPU 伪装" + 开 `resetOnLaunch`，启动看控制台是否打印 `🎭 --disable-spoofing=gpu`。

> 相关背景：`disabledSpoofing` 只影响**元数据级**伪装。GPU 维度尤其要注意——它伪造的是 WebGL vendor/renderer 字符串 + GL 能力参数 + WebGPU adapter 这一整套**上报值**，但改不了宿主真实 GPU 的**实际渲染像素**。browserscan 之类只查元数据自洽，全绿；Cloudflare Turnstile 会真渲染再比对"声称硬件 vs 实际行为"，声称非宿主 GPU 必穿帮。所以 Turnstile 场景关掉 GPU 伪装（如实上报真实 GPU）反而能过。

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
| 启动/停止/边框色的运行态 | `stop-profile` IPC + `randomFrameColor`（index.js）· `App.vue` 的 `profile-status` 监听 · `useProfileStore.frameColors` · `ProfileCard.vue`（Stop 按钮 / `displayProto` / `preProxyTag` / 边框色）|
| 应用内文档 | `resources/doc/doc.html`（`open-doc` IPC 打开，`#doc-api` 段与 `docs/api/API.md` 同步，`doc-version-sync.test.mjs` 兜底）|

---

## 测试策略

- **单测**（`node --test`）：只在**纯 CJS + 无 Electron 依赖**的模块加。目前只有 `kernel-versions.test.mjs`（15 assertions：pool 完整性、`pickFullVersionForMajor` 各种输入、`buildBrowserBrands` 品牌/顺序不变量）。想加新单测 → 先把目标函数抽到 CJS 模块
- **API 黑盒**：`scripts/api-smoke.mjs`（23）+ `api-smoke-v2.mjs`（33，v1.7.17 涨到 +4 headless / +2 language-Auto CDP）——**需要 dev 跑着**。改 API 契约必须两边都过。写新 endpoint 时同步补 test case
- **E2E CDP eval**（v1.7.17 起）：`api-smoke-v2.mjs` 里有一个 `cdpEval(port, expr)` helper（~40 行，用 `ws` 依赖），能对真实浏览器跑 `Runtime.evaluate`。目前只有 language-Auto 用它验证 `navigator.language` —— 要检查其他能只在真实浏览器里观察的东西（例如 `navigator.webdriver`、`navigator.languages`、`navigator.hardwareConcurrency`）都可以复用。**注意**：CDP 需要 profile 有 `--remote-debugging-port`，而 `?clean=true` 会**抑制**这个 flag（`src/main/index.js:6302` 的 `!useCleanProfile` gate），所以 CDP 断言不能跟 `clean=true` 组合
- **E2E 手动**：没有 Playwright 自动化。UI 改动要**真起 dev 用一下**（tabs 里的 tap，检查 CDP port chip 等）
- **网络能力**：真机测试代理相关变更用 `scripts/test-1024proxy-chain.mjs`（需要用户 Settings 里配置好的 preProxies）

**测试代理**：`socks5://127.0.0.1:7890`（用户机器上跑的 Clash）—— smoke 脚本硬编码了这个

---

## API 契约稳定性

`docs/api/API.md` 是**用户脚本作者依赖的合同**。每次改 API 必须同步更新：

- 版本头（顶部 `> 适用版本：v1.7.x`）
- 接口一览表（第二章）
- 详细章节 + `curl` 示例
- 版本号在 `package.json` 也要 bump
- **应用内文档 `resources/doc/doc.html` 的 `#doc-api` 段**（v1.7.19 起）—— 它是 API.md 的**双语应用内镜像**（离线、CSS 按 `<html lang>` 切换），改 API 必须**同步这第 3 处**。`scripts/doc-version-sync.test.mjs`（`npm test`）会校验 doc.html 与 API.md 版本头一致 + 覆盖同一批 endpoint/字段，漂了就红。设置里"查看文档"和帮助页走 `open-doc` IPC（`shell.openExternal(file://…#anchor)`，本地缺失回退线上）；`doc.html` 经 `package.json` 的 `extraResources`（`resources/doc → doc`）打包。

**已有先例**：v1.7.12 加 `disabledSpoofing` / `kernelVersion` 字段、v1.7.13 加 duplicate/runtime/kernels/settings 等 7 个新 endpoint、v1.7.14 加 `?verify=browser` + chain-aware latency、v1.7.15-16 是 audit 后连续两轮加固（race / leak 修复，无字段变化）、v1.7.17 加 `headless` 字段 + 修 language-Auto 泄漏宿主 locale 的 bug、v1.7.18 加 `preProxyStr`（per-profile 内联前置代理，覆盖全局池）、v1.7.19 把文档本地化（bundled doc.html 双语镜像 + 漂移护栏，API 契约不变）+ 一批运行态 UI（Stop 按钮、关水印时每次启动随机边框色、前置代理单选式编辑 + 卡片只读 tag、无代理显示 DIRECT）、v1.7.20 修 `resetOnLaunch` 重掷丢弃 `disabledSpoofing` 的 bug（见坑 #17，字段契约不变）+ UI 新建环境 UA 默认从"不修改"改为 Chrome 148（纯 UI 默认，API 端 `uaMode` 默认仍 `none`）。每次都跟随 semver patch bump + 完整 doc 更新。

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
