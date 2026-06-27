# GeekEZ Browser Usage Guide

## Database Configuration

GeekEZ Browser supports three database drivers via Drizzle ORM. Configure in `settings.json` (located in the app's userData directory):

| Driver | Package | Config |
|--------|---------|--------|
| SQLite (default) | built-in (`better-sqlite3`) | `{ "type": "sqlite" }` |
| PostgreSQL | `pg` | `{ "type": "postgres", "url": "postgres://user:pass@host:5432/dbname" }` |
| MySQL | `mysql2` | `{ "type": "mysql", "url": "mysql://user:pass@host:3306/dbname" }` |

### SQLite (Default)

No additional setup required. The database file is stored at `<userData>/profiles.db`.

```json
{
  "database": {
    "type": "sqlite"
  }
}
```

To use a custom path:

```json
{
  "database": {
    "type": "sqlite",
    "path": "D:/my-data/profiles.db"
  }
}
```

### PostgreSQL

1. Install the driver:
   ```bash
   npm install pg
   ```

2. Configure `settings.json`:
   ```json
   {
     "database": {
       "type": "postgres",
       "url": "postgres://username:password@localhost:5432/geekez"
     }
   }
   ```

3. Tables are created automatically on first launch.

### MySQL

1. Install the driver:
   ```bash
   npm install mysql2
   ```

2. Configure `settings.json`:
   ```json
   {
     "database": {
       "type": "mysql",
       "url": "mysql://username:password@localhost:3306/geekez"
     }
   }
   ```

3. Tables are created automatically on first launch.

### Switching Drivers

1. Stop the application
2. Update the `database` section in `settings.json`
3. Restart the application
4. Tables are auto-created; existing data is **not** migrated automatically

> Note: `pg` and `mysql2` are listed as `optionalDependencies` in `package.json` and are installed by default. If you removed them, run `npm install` to restore.

---

## API Server

Enable in Settings > Advanced > API Server. Default port: `12138`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Server status and running profile count |
| `GET` | `/api/profiles` | List all profiles (optional `?tag=xxx` filter) |
| `GET` | `/api/profiles/:idOrName` | Get profile by ID or name |
| `POST` | `/api/profiles` | Create a new profile |
| `PUT` | `/api/profiles/:idOrName` | Update an existing profile |
| `DELETE` | `/api/profiles/:idOrName` | Delete a profile |
| `GET` | `/api/open/:idOrName` | Launch a profile |
| `POST` | `/api/profiles/:idOrName/stop` | Stop a running profile |
| `GET` | `/api/export/all?password=xxx` | Full encrypted backup |
| `GET` | `/api/export/fingerprint` | Export fingerprint data |
| `POST` | `/api/import` | Import backup data |

### Launch a Profile

```bash
# By profile ID
curl http://localhost:12138/api/open/abc123

# By profile name
curl http://localhost:12138/api/open/MyProfile

# With streaming output (shows launch progress)
curl http://localhost:12138/api/open/MyProfile?stream=1

# With custom launch args
curl "http://localhost:12138/api/open/MyProfile?args=--start-maximized,--disable-gpu"
```

### Create a Profile

```bash
curl -X POST http://localhost:12138/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyProfile",
    "proxyStr": "socks5://user:pass@proxy.example.com:1080",
    "tags": ["work", "shopping"]
  }'
```

### List Profiles

```bash
# All profiles
curl http://localhost:12138/api/profiles

# Filter by tag
curl http://localhost:12138/api/profiles?tag=shopping
```

### Error Handling

All endpoints return JSON. On error:

```json
{
  "success": false,
  "error": "Error message here"
}
```

HTTP status codes: `200` (success), `400` (bad request), `404` (not found), `409` (conflict), `500` (server error).

---

## Settings Reference

Settings are stored in `<userData>/settings.json`:

```json
{
  "lang": "cn",
  "mode": "single",
  "enablePreProxy": false,
  "preProxies": [],
  "subscriptions": [],
  "userExtensions": [],
  "closeBehavior": "tray",
  "enableRemoteDebugging": false,
  "enableCustomArgs": false,
  "enableUaWebglModify": false,
  "enableApiServer": false,
  "apiPort": 12138,
  "notify": false,
  "database": {
    "type": "sqlite"
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lang` | `"cn"` \| `"en"` | `"cn"` | UI language |
| `mode` | `"single"` \| `"balance"` \| `"failover"` | `"single"` | Proxy chain mode |
| `enablePreProxy` | bool | `false` | Enable pre-proxy chain |
| `closeBehavior` | `"tray"` \| `"quit"` | `"tray"` | Window close action |
| `enableRemoteDebugging` | bool | `false` | Enable remote debug port |
| `enableCustomArgs` | bool | `false` | Allow custom Chrome args per profile |
| `enableUaWebglModify` | bool | `false` | Allow UA/WebGL customization in UI |
| `enableApiServer` | bool | `false` | Enable REST API server |
| `apiPort` | number | `12138` | API server port |
| `notify` | bool | `false` | Desktop notifications |
| `database` | object | `{"type":"sqlite"}` | Database configuration |

---

## Development

```bash
# Install dependencies (downloads Xray + Chrome, builds native modules)
npm install

# Start dev server (with hot reload)
npm run dev

# Build for production
npm run build

# Package for Windows
npm run build:win

# Package for macOS
npm run build:mac

# Package for Linux
npm run build:linux
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `USE_CHROME_FOR_TESTING=1` | Force Chrome for Testing instead of fingerprint-chromium |
| `CHROME_PATH` | Custom Chrome executable path |
| `CHROMIUM_PATH` | Custom Chromium executable path |

---

## Proxy Configuration

Supports SOCKS5, HTTP, and direct connections:

```
socks5://user:pass@host:port
http://user:pass@host:port
direct://
```

Pre-proxy (chain proxy) can be configured globally or per-profile:

- **Global**: Settings > Enable Chain Proxy
- **Per-profile**: Edit Profile > Pre-Proxy dropdown (Global / Force ON / Force OFF)

---

## Fingerprint Engine

Two engines available:

| Engine | Description |
|--------|-------------|
| **fingerprint-chromium** (default) | Patched Chromium with engine-level fingerprint spoofing |
| **Chrome for Testing** | Standard Chrome with JS-level fingerprint injection |

Switch in Settings > Advanced > "Use Chrome for Testing".

fingerprint-chromium provides engine-level protection for:
- WebGL vendor/renderer
- Canvas noise
- Audio noise
- Font list
- ClientRects noise
- User-Agent / Client Hints
- Hardware concurrency / device memory
- WebRTC IP handling
- navigator.webdriver
- Plugins
