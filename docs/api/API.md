# GeekEZ Browser · REST API 参考

> 适用版本：**v1.7.18**
> 更新日期：2026-07-18

GeekEZ Browser 提供一套本地 HTTP REST API，可通过脚本对指纹环境进行增删改查、启动、停止、备份等操作。

---

## 一、开启 API 服务

打开客户端 → `设置 (Settings) → 🔌 API 服务 (API Server) → 打开开关`。

- 默认监听地址：`http://127.0.0.1:12138`
- 端口可在设置中修改（改动后自动重启）
- 只监听 `127.0.0.1`，**无认证**，请勿转发到公网
- 所有响应类型：`application/json`（`/api/open` 的流式模式除外）
- 所有请求 body 类型：`application/json`

**如需通过 CDP 接管已启动的浏览器**：还需同时打开 `设置 → 🔧 远程调试 (Remote Debugging)`，之后创建的 profile 才会分配调试端口。

**路径参数 `:idOrName`**：可以是 profile 的 UUID，也可以是 name（name 需 URL 编码）。ID 优先。

---

## 二、接口一览

| 分类 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 状态 | GET  | `/api/status` | 查询正在运行的环境列表 |
| 查询 | GET  | `/api/profiles` | 查询所有 profile |
| 查询 | GET  | `/api/profiles/:idOrName` | 查询单个 profile 详情 |
| 查询 | GET  | `/api/profiles/:idOrName/runtime` | 查询单个 profile 的运行状态 |
| 创建 | POST | `/api/profiles` | 创建一个 profile |
| 修改 | PUT  | `/api/profiles/:idOrName` | 修改 profile |
| 复制 | POST | `/api/profiles/:idOrName/duplicate` | 克隆一个 profile |
| 删除 | DELETE | `/api/profiles/:idOrName` | 删除 profile |
| 启动 | GET  | `/api/open/:idOrName` | 启动 profile（支持 `?clean=true` 干净启动、`?verify=browser` 浏览器级验证） |
| 停止 | POST | `/api/profiles/:idOrName/stop` | 停止（支持 `?keepProxy=true`） |
| 导出 | GET  | `/api/export/all` | 导出加密全量备份 |
| 导出 | GET  | `/api/export/fingerprint` | 导出 YAML 指纹清单 |
| 导入 | POST | `/api/import` | 导入 YAML 或加密备份 |
| 设置 | GET  | `/api/settings` | 读取应用设置 |
| 设置 | PATCH | `/api/settings` | 部分更新设置（白名单字段） |
| 内核 | GET  | `/api/kernels` | 列出已安装 / 可安装的 fingerprint-chromium 版本 |
| 内核 | POST | `/api/kernels/:version` | 安装指定内核版本 |
| 内核 | DELETE | `/api/kernels/:version` | 卸载内核版本 |
| 代理 | POST | `/api/proxy/latency` | 测试代理连通性与延迟 |

---

## 三、接口详情

### 1) 查询运行状态 · `GET /api/status`

查询当前正在运行的环境 ID 列表。

**请求参数**：无

**请求示例**：
```bash
curl http://127.0.0.1:12138/api/status
```

**响应示例**：
```json
{
    "success": true,
    "running": [
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "b7d3f9e2-8c4a-4d1e-9f2b-3a5c7d9e1f8b"
    ],
    "count": 2
}
```

**v1.7.15 新增字段** `detachedTunnels`（可选）：`POST /api/profiles/:id/stop?keepProxy=true` 停掉浏览器但保留 sing-box 隧道后，profile 会**从 `running` 里剔除**，并**加进** `detachedTunnels` 数组。默认停止（`killProxy=true`）后此条目才彻底移除。字段只在有内容时出现，happy path 响应形状不变。

```json
{
    "success": true,
    "running": [ "a1b2c3d4-..." ],
    "count": 1,
    "detachedTunnels": [ "b7d3f9e2-..." ]
}
```

---

### 2) 查询 profile 列表 · `GET /api/profiles`

查询所有 profile 的简要信息。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tag` | string | 否 | 按标签精确过滤（大小写不敏感） |

**请求示例**：
```bash
# 全部
curl http://127.0.0.1:12138/api/profiles

# 只看带 tiktok 标签的
curl "http://127.0.0.1:12138/api/profiles?tag=tiktok"
```

**响应示例**：
```json
{
    "success": true,
    "profiles": [
        {
            "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "name": "TikTok-US-01",
            "tags": ["tiktok", "us"],
            "running": true
        },
        {
            "id": "b7d3f9e2-8c4a-4d1e-9f2b-3a5c7d9e1f8b",
            "name": "Amazon-Buyer-02",
            "tags": ["amazon"],
            "running": false
        }
    ]
}
```

---

### 3) 查询 profile 详情 · `GET /api/profiles/:idOrName`

按 ID 或 name 查询单个 profile 的完整信息（含指纹）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `idOrName` | string | profile 的 UUID 或 name（URL 编码） |

**请求示例**：
```bash
# 按 name
curl "http://127.0.0.1:12138/api/profiles/TikTok-US-01"

# 按 ID
curl "http://127.0.0.1:12138/api/profiles/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

**响应示例**：
```json
{
    "success": true,
    "profile": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "TikTok-US-01",
        "proxyStr": "socks5://user:pass@1.2.3.4:1080",
        "tags": ["tiktok", "us"],
        "notes": "备注：主号",
        "preProxyOverride": "default",
        "preProxyStr": "",
        "debugPort": 54321,
        "customArgs": "",
        "ignoreCertErrors": false,
        "resetOnLaunch": false,
        "headless": false,
        "isSetup": true,
        "createdAt": 1751000000000,
        "fingerprint": {
            "uaMode": "none",
            "platform": "Win32",
            "browserType": "chrome",
            "browserMajorVersion": 148,
            "browserFullVersion": "148.0.7778.167",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36",
            "screen": { "width": 1920, "height": 1080 },
            "window": { "width": 1920, "height": 1080 },
            "language": "en-US",
            "languages": ["en-US", "en"],
            "hardwareConcurrency": 8,
            "deviceMemory": 8,
            "timezone": "America/Los_Angeles",
            "city": null,
            "geolocation": null,
            "disabledSpoofing": []
        },
        "kernelVersion": null,
        "running": true
    }
}
```

**错误响应**：
```json
{ "success": false, "error": "Profile not found" }   // HTTP 404
```

---

### 4) 创建 profile · `POST /api/profiles`

创建一个新的指纹环境。所有字段都是可选的，未指定的会随机 / 使用默认值。

**Body 参数**（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 环境名。若重名会自动追加 `-02`/`-03`（两位补零）。默认 `Profile-<timestamp>` |
| `proxyStr` | string | 否 | 代理串，支持 `socks5://`、`http://`、`vmess://`、`vless://`、`trojan://`、`ss://`、`ssh://`、`hy2://`、`tuic://`。留空 = 直连 |
| `tags` | string[] \| string | 否 | 标签，数组或英文/中文逗号分隔 |
| `notes` | string | 否 | 备注 |
| `preProxyOverride` | string | 否 | 前置代理开关，仅接受 `default` / `on` / `off`。`default`=跟随全局设置；`on`=强制启用；`off`=强制禁用（对本 profile 是绝对总关，会屏蔽下面的 `preProxyStr`）。默认 `default` |
| `preProxyStr` | string | 否 | **本 profile 专属前置代理 URL**（如 `socks5://127.0.0.1:7890`）。填了就在主代理之前先经过它，**覆盖全局 preProxy 池与 `mode`**，且无需开启全局 `enablePreProxy` 即生效（非空即隐含 `on`）。留空则跟随全局设置。`preProxyOverride:'off'` 时本字段被忽略。默认 `""` |
| `customArgs` | string | 否 | 附加 Chromium 命令行参数（多行或空格分隔的 `--xxx`） |
| `ignoreCertErrors` | boolean | 否 | 是否忽略证书错误。默认 `false` |
| `resetOnLaunch` | boolean | 否 | 每次启动是否重置指纹与 user-data。默认 `false` |
| `headless` | boolean | 否 | **v1.7.17 新增**。无头模式（无可见窗口）。启用后启动时追加 `--headless=new`，并自动屏蔽 `navigator.webdriver` 信号（`--disable-blink-features=AutomationControlled`）；若 profile 没有自定义 UA，会用平台+内核大版本合成一段标准 Chrome UA，避免出现 `HeadlessChrome/…` 后缀。**仅适合自动化/服务端脚本**：反欺诈体系还有其他手段识别无头（`window.outerWidth==0`、权限 API 默认值等），主号请勿开启。默认 `false` |
| `debugPort` | number | 否 | 指定固定调试端口。留空则按需自动分配（需先开启"设置 → 远程调试"）。**v1.7.12 起分配策略从"随机"改为"从 24000 顺序填空洞"**：新 profile 依次拿 24000、24001、24002...；删除后其端口立即变回可复用槽位。这样 `netstat` 里能一眼识别 GeekEZ 占用的段。范围 24000-65000，用满会明确报错而不是静默升到高端口 |
| `kernelVersion` | string \| null | 否 | 该 profile 使用的 fingerprint-chromium 版本（如 `"148.0.7778.215"`）。留空 / `null` = 跟随应用默认（内置 pinned 版本）。不同版本会**独立缓存到本地**，首次启动如未安装会触发下载。跨 major 切换会在启动时把 `browserFullVersion` / UA / Client-Hints 元数据对齐并**回写到 profile**（下次启动稳定复用） |
| `fingerprint` | object | 否 | 指纹对象（下方"指纹字段"表） |

**`fingerprint` 字段**（都是可选，未传的会自动填充）：

> 📌 v1.7 起，指纹改由 **fingerprint-chromium 内核**统一从 `--fingerprint=<seed>` 派生（seed 稳定绑定 profile ID，`resetOnLaunch=true` 时改用随机 seed）。因此 **Canvas / Audio / WebGL / TLS 指纹会自动随内核生成**，无需在 API 里传。下方列出的都是**真正会影响运行时**的字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `uaMode` | string | `spoof`（伪装 UA/品牌）/ `none`（不改 UA，只做隔离）。默认 `none` |
| `platform` | string | `Win32` / `MacIntel` / `Linux x86_64`。必须显式指定（跨启动稳定，不再支持自动随机） |
| `browserType` | string | `chrome` / `edge`。默认 `chrome`。同时决定 uTLS 指纹（edge→edge，其他→chrome）|
| `browserMajorVersion` | number | 主版本号。目前**只支持 `148`**（传其他值会被规范化回 148） |
| `browserFullVersion` | string | 完整 Chrome patch 号（例：`148.0.7778.167`）。不传时从内置真实 Chrome 148 stable patch 池随机抽取。存储在 profile 里的值就是这个完整号，UI 编辑器里显示的 UA 也带这个 patch |
| `userAgent` | string | 覆盖 UA 字符串。**保留完整版本号**（例：`Chrome/148.0.7778.167`）—— 存储与 UI 显示都是完整版本。启动时主进程会自动做 Chrome 101+ UA-Reduction 转换：(a) 提取 patch 号作为 `--fingerprint-brand-version`（即 `Sec-CH-UA-Full-Version-List`）(b) 把传给 `--user-agent` 的字符串里 `Chrome/X.Y.Z.W` 归零为 `Chrome/X.0.0.0`。这样既保留了用户对具体版本的选择意图，又符合 Chrome 真实浏览器行为、能过 browserscan 校验 |
| `screen` | object | `{ "width": 1920, "height": 1080 }`。会用作启动窗口大小 |
| `language` | string | 主语言，如 `en-US`。传 `auto` 或不传 = 根据出口 IP 自动匹配（`COUNTRY_TO_LANG` 表映射代理出口国 → 语言）。**v1.7.17 修复**：此前 `--lang` / `--accept-lang` 的推送 gate 在 Auto-IP 派生之前被固化，导致 `auto` 时 IP 派生的语言不会真的推给 Chrome，`navigator.language` 反而暴露宿主系统 locale（zh-CN 之类）。1.7.17 起 gate 改为读派生**后**的 `fingerprint.language`，行为与文档一致。如果你之前 API 传 `"language": "auto"` 且脚本依赖 Chrome 报出宿主 locale，请显式改传目标语言（如 `"en-US"`）以保持旧行为 |
| `languages` | string[] | 语言列表，如 `["en-US","en"]`。未传会从 `language` 派生 |
| `timezone` | string | IANA 时区，如 `America/New_York`；传 `Auto` / `auto` / 不传 = 跟随 IP |
| `hardwareConcurrency` | number | CPU 核数，取值 `4` / `8` / `12` / `16`。默认随机 |
| `deviceMemory` | number | 内存 GB，取值 `2` / `4` / `8` / `16`。默认随机 |
| `geolocation` | object \| null | 地理定位。格式 `{ "latitude": 40.7, "longitude": -74.0, "accuracy": 100 }`。通过内置扩展劫持 `navigator.geolocation` |
| `city` | object \| null | **仅元数据**，用于 UI 展示（如 `{ "name": "New York", "lat": 40.7, "lng": -74.0 }`）。实际生效的是 `geolocation` |
| `disabledSpoofing` | string[] | 关闭 fingerprint-chromium 对指定维度的内置伪装（转为 `--disable-spoofing=<csv>` flag），取值 `canvas` / `audio` / `clientrects` / `gpu` 的任意子集。默认 `[]`（全部保留伪装）。**需要 kernel 144+**；数组元素会自动去重、非法值过滤。`font` 由跨平台状态自动管理，不接受手动传入 |

**已废弃/不再生效的字段**（旧文档 & 旧客户端可能还在传，但当前版本会忽略）：

| 字段 | 状态 |
|---|---|
| `canvasNoise` | ❌ 由内核 seed 派生，字段被忽略 |
| `audioNoise` | ❌ 由内核 seed 派生，字段被忽略 |
| `noiseSeed` | ❌ 内核 seed 由 profile ID 稳定哈希生成，字段被忽略 |
| `webgl` / `webglProfile` | ❌ fingerprint-chromium 144+ 已移除 GPU spoof 参数，字段被忽略 |
| `tlsClientHello` | ❌ 运行时由 `browserType` 派生，字段被忽略 |
| `userAgentMetadata` | ❌ 由指纹引擎按 `browserType` + `browserFullVersion` 自动构建 |

**请求示例（最简）**：
```bash
curl -X POST http://127.0.0.1:12138/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TikTok-US-01",
    "proxyStr": "socks5://user:pass@1.2.3.4:1080",
    "tags": ["tiktok", "us"]
  }'
```

**请求示例（带指纹）**：
```bash
curl -X POST http://127.0.0.1:12138/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Amazon-DE-Seller",
    "proxyStr": "http://user:pass@de.proxy.com:8080",
    "tags": ["amazon", "de"],
    "notes": "德国卖家账号",
    "fingerprint": {
        "uaMode": "spoof",
        "platform": "Win32",
        "browserType": "chrome",
        "browserMajorVersion": 148,
        "language": "de-DE",
        "languages": ["de-DE", "de", "en"],
        "timezone": "Europe/Berlin",
        "hardwareConcurrency": 8,
        "deviceMemory": 16,
        "screen": { "width": 1920, "height": 1080 },
        "geolocation": { "latitude": 52.52, "longitude": 13.405, "accuracy": 100 }
    }
  }'
```

**请求示例（v1.7.12 新字段 · 每类别 disable-spoofing + kernel 版本）**：
```bash
curl -X POST http://127.0.0.1:12138/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TikTok-Sensitive",
    "proxyStr": "socks5://user:pass@1.2.3.4:1080",
    "tags": ["tiktok"],
    "kernelVersion": "148.0.7778.215",
    "fingerprint": {
        "uaMode": "spoof",
        "platform": "Win32",
        "browserMajorVersion": 148,
        "timezone": "America/Los_Angeles",
        "language": "en-US",
        "disabledSpoofing": ["canvas", "audio"]
    }
  }'
```

> `disabledSpoofing` 用于反欺诈误判某个维度的场景 —— 关掉后该维度会呈现主机真实值。`canvas` / `audio` 关掉相当于让内核 seed 派生的噪声失效，Chromium 走原生渲染路径；`clientrects` / `gpu` 同理。仅在 kernel 144+ 生效，旧 kernel 会静默忽略。

**请求示例（v1.7.17 新字段 · 无头模式）**：
```bash
curl -X POST http://127.0.0.1:12138/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "auto-worker-01",
    "proxyStr": "socks5://user:pass@1.2.3.4:1080",
    "tags": ["automation"],
    "headless": true,
    "fingerprint": {
        "platform": "Win32",
        "language": "en-US",
        "timezone": "America/New_York"
    }
  }'
```

> `headless: true` 后启动的 Chrome 没有窗口，但 CDP / API 依然可用 —— 常规 `POST /api/profiles/:id/stop` 也照常工作。启动后可以通过 `/api/open` 响应里的 `"remote port"` 直接接 Playwright / DevTools。**注意反欺诈风险**：Chrome 132+ 只保留 `--headless=new`（等同真实渲染管线），`navigator.webdriver` 已通过 `--disable-blink-features=AutomationControlled` 屏蔽，UA 后缀也做了改写，但 `window.outerWidth == 0`、`Notification.permission === 'denied'` 等无头默认值仍会泄漏 —— 不要给主账号开。

**响应示例**：
```json
{
    "success": true,
    "profile": {
        "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "name": "TikTok-US-01",
        "proxyStr": "socks5://user:pass@1.2.3.4:1080",
        "tags": ["tiktok", "us"],
        "debugPort": 54321,
        "fingerprint": { "...": "..." },
        "createdAt": 1751000000000
    },
    "remoteDebugPort": 54321
}
```

> **关于 `remoteDebugPort`**：只有当"设置 → 远程调试"打开时才会分配并返回。关闭时字段为 `null`。同一 profile 每次启动**通常**都用同一个 debugPort（稳定 1:1），但如果启动时发现该端口已被系统上其他程序占用（IDE、另一个 Chrome 实例、别的应用），GeekEZ 会为本次启动动态换一个空闲端口 —— **持久化的 `debugPort` 不变**（下次启动继续尝试原端口，冲突消失后自然回到 1:1），本次实际绑定的端口通过 `/api/open` 响应的 `"remote port"` 字段返回，脚本按响应值连接即可。

---

### 5) 修改 profile · `PUT /api/profiles/:idOrName`

修改现有 profile。Body 结构与创建接口完全一致，字段可以部分更新，未传字段保留原值。

⚠️ profile 正在启动或运行时会返回 **409**，需先停止。

**请求示例（改代理和标签）**：
```bash
curl -X PUT "http://127.0.0.1:12138/api/profiles/TikTok-US-01" \
  -H "Content-Type: application/json" \
  -d '{
    "proxyStr": "socks5://new-user:new-pass@5.6.7.8:1080",
    "tags": ["tiktok", "us", "backup"]
  }'
```

**响应示例**：
```json
{
    "success": true,
    "profile": {
        "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "name": "TikTok-US-01",
        "proxyStr": "socks5://new-user:new-pass@5.6.7.8:1080",
        "tags": ["tiktok", "us", "backup"],
        "debugPort": 54321,
        "fingerprint": { "...": "..." }
    },
    "remoteDebugPort": 54321
}
```

**错误响应（正在运行）**：
```json
{ "success": false, "error": "Cannot edit a running or launching profile. Please stop the browser first." }
// HTTP 409
```

---

### 6) 删除 profile · `DELETE /api/profiles/:idOrName`

删除 profile，同时删除磁盘上的 `browser_data` 目录。若目录被占用，先备份到 `_Trash_Bin`。

⚠️ profile 正在启动或运行时会返回 **409**，需先停止。

**请求示例**：
```bash
curl -X DELETE "http://127.0.0.1:12138/api/profiles/TikTok-US-01"
```

**响应示例**：
```json
{ "success": true, "message": "Profile deleted" }
```

**错误响应**：
```json
{ "success": false, "error": "Profile not found" }   // HTTP 404
{ "success": false, "error": "Cannot delete a running or launching profile. Please stop the browser first." }   // HTTP 409
```

---

### 7) 启动 profile · `GET /api/open/:idOrName`

启动一个 profile。返回调试端口（若开启了远程调试）。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `lang` | string | 否 | 启动过程提示语言，`en` / `cn`。默认跟随应用语言 |
| `args` | string | 否 | 本次启动**临时**追加的 Chromium 参数（覆盖 profile 的 `customArgs`）。多个 `args=` 可以重复传，或用一个 `args=` 传入以空格分隔的字符串。只接受 `--xxx` 格式 |
| `stream` | string | 否 | `true` / `1` = 流式返回启动进度（`text/plain`）；`false` / `0` = 返回 JSON。默认按 `User-Agent` 判断（curl/wget 自动流式） |

**请求示例（JSON 模式）**：
```bash
curl "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false"
```

**响应示例（JSON 模式）**：
```json
{
    "success": true,
    "message": "Launched",
    "profileId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "TikTok-US-01",
    "launchArgs": [],
    "remote port": 54321
}
```

> ⚠️ **注意字段名 `"remote port"` 中间有空格**（历史兼容）。JS 读取需要用中括号：`res["remote port"]`。
>
> **关键**：这个值是 Chrome 本次**实际绑定**的端口，不一定等于 `profile.debugPort`。当持久化的端口被系统上其他程序占着时，GeekEZ 会为本次启动动态换一个端口（详见"创建 profile"接口里 `debugPort` 字段的说明）。**任何 CDP 连接都应该按 `"remote port"` 的返回值来连**，不要硬编码 `profile.debugPort`。

**已在运行时的响应**：
```json
{
    "success": true,
    "message": "Already running",
    "profileId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "TikTok-US-01",
    "remote port": 54321
}
```

**请求示例（流式模式）**：
```bash
curl -N "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=true&lang=cn"
```

**响应示例（流式模式，`text/plain`）**：
```
TikTok-US-01 环境启动中... 正在检查环境目录...
TikTok-US-01 环境启动中... 正在生成指纹...
TikTok-US-01 环境启动中... 正在启动代理...
TikTok-US-01 环境启动中... 正在启动 Chromium...
TikTok-US-01 启动成功。
远程调试端口：54321
```

**请求示例（本次临时加参数）**：
```bash
# 通过 args 覆盖本次启动参数（可重复传）
curl "http://127.0.0.1:12138/api/open/TikTok-US-01?args=--disable-gpu&args=--window-size=1280,720"
```

---

### 8) 停止 profile · `POST /api/profiles/:idOrName/stop`

停止一个正在运行的 profile。同时会终止关联的 sing-box 进程。

**请求示例**：
```bash
curl -X POST "http://127.0.0.1:12138/api/profiles/TikTok-US-01/stop"
```

**响应示例**：
```json
{ "success": true, "message": "Profile stopped" }
```

**错误响应**：
```json
{ "success": false, "error": "Profile not running" }   // HTTP 404
```

---

### 9) 导出全量加密备份 · `GET /api/export/all`

导出所有 profile 的加密备份（含指纹 + 浏览器数据 + Cookie + 密码）。备份用 AES-256 加密后 Gzip 压缩，最终 Base64 编码。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `password` | string | ✅ | 加密密码（导入时需要同一密码） |

**请求示例**：
```bash
curl "http://127.0.0.1:12138/api/export/all?password=my-secret-pw" \
  -o backup.json
```

**响应示例**：
```json
{
    "success": true,
    "data": "AES+Gzip+Base64 后的整包字符串...",
    "filename": "GeekEZ_FullBackup_1751000000000.geekez",
    "profileCount": 15
}
```

**部分失败时的响应**（v1.7.12 起）：如果某些 profile 的 cookies、密码或浏览器文件因为浏览器正在运行等原因读取失败，响应会**额外**带一个 `warnings` 字段列出受影响的 profile，`success: true` 不变（数据仍已导出到 `data`，但部分 profile 的这部分内容缺失）：

```json
{
    "success": true,
    "data": "AES+Gzip+Base64 后的整包字符串...",
    "filename": "GeekEZ_FullBackup_1751000000000.geekez",
    "profileCount": 15,
    "warnings": {
        "partialCount": 2,
        "profiles": [
            {
                "profileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "name": "TikTok-US-01",
                "filesSkipped": ["History: EBUSY"],
                "cookiesError": "target closed",
                "passwordsError": null
            },
            {
                "profileId": "b7d3f9e2-8c4a-4d1e-9f2b-3a5c7d9e1f8b",
                "name": "Amazon-DE-Seller",
                "filesSkipped": ["(no browser_data — profile never launched)"],
                "cookiesError": null,
                "passwordsError": null
            }
        ]
    }
}
```

> `warnings` 只在有真实失败时才出现，happy-path 响应形状不变。老客户端可以无视这个字段；新客户端建议在导出后检查 `warnings.partialCount > 0` 并提醒用户"这些 profile 的 cookies/密码没进备份"。之前的行为是静默吞掉这些错误、`success: true` 直接返回。

**保存 `.geekez` 文件的用法**（把 `data` 字段的 Base64 解出并落盘）：

```bash
curl -s "http://127.0.0.1:12138/api/export/all?password=my-secret-pw" \
  | jq -r .data \
  | base64 -d > GeekEZ_FullBackup.geekez
```

**错误响应**：
```json
{ "success": false, "error": "Password required. Use ?password=yourpassword" }   // HTTP 400
```

---

### 10) 导出 YAML 指纹清单 · `GET /api/export/fingerprint`

只导出所有 profile 的指纹 + 代理 + 标签，YAML 格式，**不包含**浏览器数据、Cookie、密码。适合团队间同步指纹配置。

**请求参数**：无

**请求示例**：
```bash
curl "http://127.0.0.1:12138/api/export/fingerprint"
```

**响应示例**：
```json
{
    "success": true,
    "data": "- id: f47ac10b-58cc-4372-a567-0e02b2c3d479\n  name: TikTok-US-01\n  proxyStr: ...\n  tags:\n    - tiktok\n  fingerprint: ...\n",
    "filename": "GeekEZ_Profiles_1751000000000.yaml",
    "profileCount": 15
}
```

---

### 11) 导入 profile · `POST /api/import`

从 YAML 或加密备份导入 profile。**导入不会覆盖同名 profile**，重名会自动追加 `-02`/`-03`（两位补零）。

**Body 参数**（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | string | ✅ | 导入内容。可以是 YAML 文本，或加密备份的 Base64 字符串 |
| `password` | string | 视情况 | 加密备份必填；YAML 无需 |

**请求示例（导入 YAML）**：
```bash
curl -X POST http://127.0.0.1:12138/api/import \
  -H "Content-Type: application/json" \
  -d '{
    "content": "- id: xxx\n  name: TikTok-US-01\n  proxyStr: socks5://...\n  fingerprint: {...}"
  }'
```

**请求示例（导入加密备份）**：
```bash
# 先把 .geekez 文件 base64 编码
BACKUP=$(base64 -w0 GeekEZ_FullBackup.geekez)

curl -X POST http://127.0.0.1:12138/api/import \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$BACKUP\",\"password\":\"my-secret-pw\"}"
```

**响应示例**：
```json
{
    "success": true,
    "message": "Imported 15 profiles from backup",
    "count": 15
}
```

**错误响应**：
```json
{ "success": false, "error": "Content required" }                       // HTTP 400
{ "success": false, "error": "Password required for encrypted backup" } // HTTP 400
{ "success": false, "error": "Invalid password or corrupted backup" }   // HTTP 400
```

---

## 四、错误响应统一约定

所有错误都返回如下格式：

```json
{
    "success": false,
    "error": "错误描述"
}
```

**HTTP 状态码**：

| 状态码 | 含义 |
|---|---|
| **200** | 成功 |
| **400** | 请求体格式错误 / 参数缺失 |
| **404** | Profile 不存在，或运行中的 profile 找不到 |
| **409** | Profile 正在运行/启动中，不允许修改或删除 |
| **500** | 服务器内部错误（磁盘写失败、进程启动失败等） |

---

## 五、结合 CDP 做自动化

启动 profile 后，`remote port` 就是标准 Chrome DevTools Protocol 端口，可直接对接 Playwright / Puppeteer / chrome-remote-interface。

**前置条件**：
1. `设置 → 🔧 远程调试` 已打开
2. Profile 创建时（或通过 PUT 补写）已分配 `debugPort`
3. Profile 启动时**未**使用 "使用干净 profile 启动" 模式（该模式会剥离调试端口）

**Playwright（Node.js）**：
```js
const { chromium } = require('playwright-core');

// 1. 让 GeekEZ 启动 profile 并拿到端口
const res = await fetch('http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false')
    .then(r => r.json());
const port = res['remote port'];   // ← 注意字段名带空格

// 2. Playwright 通过 CDP 接管
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();

await page.goto('https://www.tiktok.com/');
```

**Puppeteer（Node.js）**：
```js
const puppeteer = require('puppeteer-core');

const res = await fetch('http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false')
    .then(r => r.json());
const port = res['remote port'];

const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null
});
const page = (await browser.pages())[0];
await page.goto('https://www.tiktok.com/');
```

**Python（DrissionPage / Playwright）**：
```python
import requests

res = requests.get(
    'http://127.0.0.1:12138/api/open/TikTok-US-01',
    params={'stream': 'false'}
).json()
port = res['remote port']

# Playwright
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    ctx = browser.contexts[0]
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto('https://www.tiktok.com/')
```

---

## 六、完整脚本示例（Node.js）

一站式：**创建 → 启动 → CDP 自动化 → 停止**。

```js
const http = require('http');
const { chromium } = require('playwright-core');

const API = 'http://127.0.0.1:12138';

async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

(async () => {
    // 1. 创建（若已存在会重名报错，可按需先查询）
    const created = await api('POST', '/api/profiles', {
        name: 'demo-yt',
        proxyStr: 'socks5://127.0.0.1:7890',
        tags: ['demo'],
        fingerprint: {
            platform: 'Win32',
            language: 'en-US',
            timezone: 'America/New_York'
        }
    });
    console.log('Created:', created.profile.id);

    // 2. 启动并拿调试端口
    const opened = await api('GET', '/api/open/demo-yt?stream=false');
    const port = opened['remote port'];
    console.log('Debug port:', port);

    // 3. 接管
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://www.youtube.com/');
    console.log('Title:', await page.title());
    await browser.close();   // 只断开 Playwright，不关浏览器

    // 4. 停止
    await api('POST', '/api/profiles/demo-yt/stop');
    console.log('Stopped');
})();
```

---

## 七、v1.7.13 新增接口

### 12) 复制 profile · `POST /api/profiles/:idOrName/duplicate`

克隆一个 profile。原 profile 的 fingerprint / customArgs / kernelVersion / preProxyOverride / preProxyStr / resetOnLaunch / headless 都会带过来；新 profile 拿到新的 UUID（→ 新的 fingerprint-chromium seed → canvas/audio/WebGL 哈希跟原 profile 天然不同），以及自动分配的新 `debugPort`。

**Body 参数**（全部可选，用于覆盖复制默认值）：
| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 新名字。留空则用 `<原名>-copy`（重名自动追加 `-02`） |
| `tags` | string[] | 覆盖 tags |
| `proxyStr` | string | 覆盖代理 |
| `notes` | string | 覆盖备注 |
| `fingerprint` | object | 部分覆盖 fingerprint 字段（会跟原 fp deep-merge） |

**请求示例**：
```bash
curl -X POST "http://127.0.0.1:12138/api/profiles/TikTok-US-01/duplicate" \
  -H "Content-Type: application/json" \
  -d '{ "name": "TikTok-US-01-backup", "tags": ["tiktok", "us", "backup"] }'
```

**响应**：
```json
{
    "success": true,
    "source": { "id": "...", "name": "TikTok-US-01" },
    "profile": { "id": "<new UUID>", "name": "TikTok-US-01-backup", ... },
    "remoteDebugPort": 24012
}
```

---

### 13) 查询运行状态 · `GET /api/profiles/:idOrName/runtime`

比 `/api/status` 更细：只关心一个 profile 时不用捞全表。

**响应**：
```json
{
    "success": true,
    "profileId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "TikTok-US-01",
    "running": true,
    "launching": false,
    "remote port": 24009,
    "persistedDebugPort": 24009,
    "kernelVersion": "148.0.7778.215"
}
```

`"remote port"` 是**本次实际绑定**的端口（可能被 OS 冲突降级为动态端口），`persistedDebugPort` 是 profile 表里存的值。停止时 `"remote port"` 为 `null`。

---

### 14) 停止 profile 的增强 · `POST /api/profiles/:idOrName/stop`

新增查询参数：
| 参数 | 默认 | 说明 |
|---|---|---|
| `keepProxy` | `false` | `true` = 只关浏览器，保留 sing-box 代理隧道运行。用于把该 profile 的 socks 端口留给别的工具接管 |
| `closeBrowser` | `true` | `false` = 只杀代理不关浏览器（罕见，调试隧道用） |

**示例**：
```bash
# 关浏览器，代理留着
curl -X POST "http://127.0.0.1:12138/api/profiles/TikTok-US-01/stop?keepProxy=true"
```

---

### 15) 启动的 clean 模式 · `GET /api/open/:idOrName?clean=true`

对应 UI "使用干净 profile 启动"：本次启动用一个临时的 user-data 目录，不加载已装扩展、不恢复上次会话，退出后不留痕。适合每次都要 fresh 的自动化流程。

```bash
curl "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false&clean=true"
```

---

### 15.5) 浏览器级代理验证 · `GET /api/open/:idOrName?verify=browser`

**问题背景**：默认的 launch 只探测到 sing-box 隧道层（拿 Node 起个 socks5 client 打 gstatic），拿到"通"就返回响应。这在极少数情况下会误判 —— sing-box 隧道通不代表 Chrome 一定能用（Chrome 策略覆盖代理设置、扩展干扰、缓存中毒的 PAC 等），大约 2-5% 概率。

**加 `?verify=browser` 后**：sing-box 探测通过 + Chrome 起来之后，再通过 CDP 主动 `Page.navigate` 一个探测 URL（默认 `https://www.gstatic.com/generate_204`），等收到浏览器视角的 top-level HTTP 响应才算成功。**响应成功 = 用户脚本立刻 CDP 接管一定能用**。

**代价**：响应延迟增加 2-10s（Chrome 首屏导航时间）；总延迟从"5-15s"变为"10-25s"。

**前置条件**：Settings → 远程调试**必须打开**（无 CDP 无从验证）。

**参数**：
| 参数 | 默认 | 说明 |
|---|---|---|
| `verify` | `off` | `browser` = 开启浏览器级验证 |
| `verifyUrl` | `https://www.gstatic.com/generate_204` | 覆盖探测目标 |
| `verifyStrict` | `true` | `false` = 允许 3xx 通过（用于会重定向的探测 URL，如 HTTP→HTTPS 升级）。默认拒绝 3xx —— 因为**热点门户** (hotel wifi 302 → login page) 是最常见的假阳性。响应会加 `verify.redirected: true` 标识 |

**v1.7.15 新增**：3xx 响应现在默认被判为**失败**（redirect / possible captive portal）。如果你的探测目标合法地会重定向，加 `?verifyStrict=false`。

**验证失败时**：**profile 会被自动 stop**（避免留着一个坏 profile），返回 HTTP 500：
```json
{
    "success": false,
    "error": "navigation failed: net::ERR_TUNNEL_CONNECTION_FAILED",
    "phase": "browser-verify",
    "profileId": "..."
}
```

**验证成功时**：正常返回，附加 `verify` 字段：
```json
{
    "success": true,
    "message": "Launched",
    "profileId": "...",
    "remote port": 24010,
    "verify": {
        "ok": true,
        "status": 204,
        "latencyMs": 7830,
        "target": "https://www.gstatic.com/generate_204"
    }
}
```

**请求示例**：
```bash
# 默认目标
curl "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false&verify=browser"

# 换成自己的探测 URL
curl "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=false&verify=browser&verifyUrl=https://httpbin.org/status/200"

# 流式模式也支持，会打印"正在验证浏览器代理连通性..."
curl -N "http://127.0.0.1:12138/api/open/TikTok-US-01?stream=true&verify=browser"
```

**推荐用法**：
- 一次性 provision 脚本（要求 100% 稳）→ 建议开
- 大批量并发 launch（追求速度）→ 别开
- 交互式 UI 用户 → 默认不开

---

### 16) 应用设置读写 · `GET / PATCH /api/settings`

**读取**：`GET /api/settings` 返回整个设置快照（包括 preProxies / subscriptions / userExtensions 等）。

**部分更新**（PATCH）：只接受下面这些**标量**字段，**每个都有类型/取值校验**（v1.7.15+）。数组类字段（preProxies / subscriptions / userExtensions）有专门的 UI 管理入口，PATCH 拒绝（400）。类型不对（如 `apiPort:"abc"`）或超出取值范围（如 `apiPort:22`）也返回 400 而不是持久化到磁盘。

| 字段 | 类型 | 取值 / 校验 | 生效时机 |
|---|---|---|---|
| `enableRemoteDebugging` | boolean | — | 下次 profile 启动 |
| `enableCustomArgs` | boolean | — | 下次启动 |
| `enableUaModify` / `enableUaWebglModify` | boolean | — | 下次启动 |
| `enablePreProxy` | boolean | — | 下次启动 |
| `enableApiServer` | boolean | — | **需应用重启** |
| `enableWatermark` | boolean | — | 下次启动 |
| `closeBehavior` | string | `tray` \| `exit` | 即刻 |
| `lang` | string | `en` \| `cn` | 即刻（tray） |
| `notify` | boolean | — | 即刻 |
| `apiPort` | number | 1024-65535 整数 | **需应用重启** |
| `watermarkStyle` | string | — | 下次启动 |
| `ipInfoProvider` | string | `ipinfo` \| `ipwho` \| `ipapi` | 下次启动 |
| `mode` | string | `single` \| `balance` \| `failover` | 即刻 |
| `selectedId` | string \| null | 非空字符串或 null | 即刻 |

```bash
# 打开远程调试
curl -X PATCH http://127.0.0.1:12138/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "enableRemoteDebugging": true }'
```

**响应**：
```json
{
    "success": true,
    "updated": { "enableRemoteDebugging": true },
    "settings": { ... }
}
```

**新增字段 `restartRequired: true`**：改动 `enableApiServer` 或 `apiPort` 时响应会附加此字段，提示脚本用户"改动已持久化，但当前 API server 需要重启应用后才切换"（v1.7.15 修正之前"立即生效"的误导性文档）：
```json
{
    "success": true,
    "updated": { "apiPort": 12139 },
    "settings": { ... },
    "restartRequired": true
}
```

---

### 17) 内核管理 · `/api/kernels`

对应 UI "设置 → 🧠 浏览器内核" 面板。

**GET `/api/kernels`** — 列出已装内核。
| 参数 | 默认 | 说明 |
|---|---|---|
| `available` | `false` | `true` = 同时拉取 GitHub 上游可下载版本 |
| `measureSize` | `false` | `true` = 计算每个已装内核占用的磁盘字节 |

```json
{
    "success": true,
    "pinned": "148.0.7778.215",
    "installed": [
        { "version": "148.0.7778.215", "execPath": "...", "installedAt": 1751000000000, "size": 0 }
    ],
    "available": [
        { "version": "148.0.7778.218", "assetName": "...", "assetSize": 445122048, "publishedAt": "..." }
    ]
}
```

**POST `/api/kernels/:version`** — 安装。**同步阻塞**直到下载+解压完成（可能几分钟）；已装则立即返回 `alreadyInstalled: true`。

```bash
curl -X POST http://127.0.0.1:12138/api/kernels/144.0.7559.132
```

**DELETE `/api/kernels/:version`** — 卸载。拒绝卸载 pinned 版本（409）、拒绝卸载正在被运行 profile 使用的版本（409）。

---

### 18) 代理测试 · `POST /api/proxy/latency`

对代理做一次真实的 handshake + 探测 gstatic/cloudflare，返回延迟和是否可用。

**Body**（三种模式）：

```json
{ "proxyStr": "socks5://user:pass@1.2.3.4:1080" }
```
直接测这个 URL —— 从本机到代理**单跳**，不套任何 preProxy。

```json
{ "profileId": "TikTok-US-01" }
```
拿该 profile 的 proxyStr **走完整链路**测。如果 profile 设了专属 `preProxyStr`，探测会**优先走这个专属前置**（覆盖全局池）；否则若 `preProxyOverride: 'on'` 或全局 `enablePreProxy: true`，探测会**通过 App 内配置的 preProxy 节点**再到 profile 的代理。**这是推荐用法** —— 因为很多境外代理需要走 preProxy 才通（比如某些地区封锁直连或代理服务本身有地域限制）。

```json
{ "profileId": "TikTok-US-01", "chain": false }
```
即使 profile 有 preProxy 也**强制单跳**（用于隔离诊断：判断 profile 自身代理是不是真死了还是路由问题）。

**响应**：
```json
{
    "success": true,
    "latency": 187,
    "target": "www.google.com",
    "chain": { "preProxy": "192.220.57.173-vless-reality" }
}
```

- `success`: 是否连通
- `latency`: 首次响应延迟（毫秒，字段名不叫 `latencyMs`，注意别拼错）
- `target`: 实际打通的探测 URL host
- `chain`: 用了哪个 preProxy 做前置；`null` 表示单跳
- 失败时会有 `msg` + `details[]` 数组，包含每个探测目标的失败原因

用途：批量启动前预筛"哪些 profile 的 proxy 死了" —— 建议用 `{ profileId }` 模式，因为**单跳往往测不出真实可用性**（例：US HTTP 代理直接从中国 IP 打就 ECONNRESET，但套上 preProxy 走就通）。

---

## 八、字段名约定速查

- **profile id**：UUID v4 字符串
- **profile name**：唯一，Unicode，重名会自动追加 `-02`/`-03`（两位补零）
- **时间戳**：全部使用 UTC 毫秒（`Date.now()`）
- **`remote port`**：字段名**含空格**（历史兼容），JS 读取需 `obj['remote port']`
- **代理字符串留空** = 直连
- **`resetOnLaunch: true`** = 每次启动前清空 user-data，指纹重掷（适合一次性场景）
