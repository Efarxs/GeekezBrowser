# GeekEZ Browser · REST API 参考

> 适用版本：**v1.7.0-beta**
> 更新日期：2026-07-05

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
| 创建 | POST | `/api/profiles` | 创建一个 profile |
| 修改 | PUT  | `/api/profiles/:idOrName` | 修改 profile |
| 删除 | DELETE | `/api/profiles/:idOrName` | 删除 profile |
| 启动 | GET  | `/api/open/:idOrName` | 启动 profile（返回调试端口） |
| 停止 | POST | `/api/profiles/:idOrName/stop` | 停止运行中的 profile |
| 导出 | GET  | `/api/export/all` | 导出加密全量备份 |
| 导出 | GET  | `/api/export/fingerprint` | 导出 YAML 指纹清单 |
| 导入 | POST | `/api/import` | 导入 YAML 或加密备份 |

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
        "debugPort": 54321,
        "customArgs": "",
        "ignoreCertErrors": false,
        "resetOnLaunch": false,
        "isSetup": true,
        "createdAt": 1751000000000,
        "fingerprint": {
            "uaMode": "auto",
            "platform": "Win32",
            "browserType": "chrome",
            "browserMajorVersion": 148,
            "browserFullVersion": "148.0.7778.215",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
            "screen": { "width": 1920, "height": 1080 },
            "language": "en-US",
            "languages": ["en-US", "en"],
            "hardwareConcurrency": 8,
            "deviceMemory": 8,
            "timezone": "America/Los_Angeles",
            "webglProfile": "win_nvidia_rtx_3060",
            "canvasNoise": { "r": 3, "g": -2, "b": 5, "a": 1 },
            "audioNoise": 0.0000005
        },
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
| `name` | string | 否 | 环境名。若重名会自动追加 `-2/-3`。默认 `Profile-<timestamp>` |
| `proxyStr` | string | 否 | 代理串，支持 `socks5://`、`http://`、`vmess://`、`vless://`、`trojan://`、`ss://`、`ssh://`、`hy2://`、`tuic://`。留空 = 直连 |
| `tags` | string[] \| string | 否 | 标签，数组或英文/中文逗号分隔 |
| `notes` | string | 否 | 备注 |
| `preProxyOverride` | string | 否 | 前置代理开关，仅接受 `default` / `on` / `off`。`default`=跟随全局设置；`on`=强制启用；`off`=强制禁用。默认 `default` |
| `customArgs` | string | 否 | 附加 Chromium 命令行参数（多行或空格分隔的 `--xxx`） |
| `ignoreCertErrors` | boolean | 否 | 是否忽略证书错误。默认 `false` |
| `resetOnLaunch` | boolean | 否 | 每次启动是否重置指纹与 user-data。默认 `false` |
| `debugPort` | number | 否 | 指定固定调试端口。默认按需自动分配（需先开启远程调试） |
| `fingerprint` | object | 否 | 指纹对象（下方"指纹字段"表） |

**`fingerprint` 常用字段**（都是可选，未传的会自动填充）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `uaMode` | string | `auto` / `custom` / `none`。默认 `auto` |
| `platform` | string | `Win32` / `MacIntel` / `Linux x86_64` / `auto` |
| `browserType` | string | `chrome` / `edge`。默认随机 |
| `browserMajorVersion` | number | 如 `148` |
| `browserFullVersion` | string | 如 `148.0.7778.215` |
| `userAgent` | string | 显式覆盖 UA |
| `tlsClientHello` | string | uTLS 指纹：`chrome` / `edge` / `firefox` / `safari` / `ios` / `android` / `random` / `randomized` / ... |
| `screen` | object | `{ "width": 1920, "height": 1080 }` |
| `language` | string | 语言，如 `en-US`。传 `auto` 或不传 = 根据 IP 自动 |
| `languages` | string[] | `["en-US","en"]` |
| `hardwareConcurrency` | number | CPU 核数，4/8/12/16 |
| `deviceMemory` | number | 内存 GB，2/4/8/16 |
| `timezone` | string | IANA 时区，如 `America/New_York`；传 `auto` = 跟随 IP |
| `city` | object \| null | `{ "name": "New York", "lat": 40.7, "lng": -74.0 }` |
| `geolocation` | object \| null | `{ "latitude": 40.7, "longitude": -74.0, "accuracy": 100 }` |
| `webglProfile` | string | WebGL 预设 ID，如 `win_nvidia_rtx_3060`；`none` = 不改 |
| `canvasNoise` | object | `{ "r": 3, "g": -2, "b": 5, "a": 1 }` |
| `audioNoise` | number | 如 `0.0000005` |
| `noiseSeed` | number | 随机种子（决定 canvas/audio 噪声的稳定性） |

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
        "platform": "Win32",
        "browserType": "chrome",
        "browserMajorVersion": 148,
        "language": "de-DE",
        "languages": ["de-DE", "de", "en"],
        "timezone": "Europe/Berlin",
        "hardwareConcurrency": 8,
        "deviceMemory": 16,
        "screen": { "width": 1920, "height": 1080 },
        "webglProfile": "win_nvidia_rtx_3060",
        "tlsClientHello": "chrome"
    }
  }'
```

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

> **关于 `remoteDebugPort`**：只有当"设置 → 远程调试"打开时才会分配并返回。关闭时字段为 `null`。同一 profile 每次启动都用同一个 debugPort（稳定 1:1）。

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

从 YAML 或加密备份导入 profile。**导入不会覆盖同名 profile**，重名会自动追加 `-2/-3`。

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

## 七、字段名约定速查

- **profile id**：UUID v4 字符串
- **profile name**：唯一，Unicode，重名会自动追加 `-2/-3`
- **时间戳**：全部使用 UTC 毫秒（`Date.now()`）
- **`remote port`**：字段名**含空格**（历史兼容），JS 读取需 `obj['remote port']`
- **代理字符串留空** = 直连
- **`resetOnLaunch: true`** = 每次启动前清空 user-data，指纹重掷（适合一次性场景）
