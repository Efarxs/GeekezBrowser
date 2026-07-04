# GeekEZ Browser — CDP automation examples

Small Playwright scripts that connect to a **running** GeekEZ Browser
profile over CDP. The profile itself is launched by GeekEZ Browser (the
Electron app) — Playwright only *attaches* to the existing fingerprint-
chromium process. This keeps the launch path stealthy (no puppeteer /
Playwright launching Chrome, no `--enable-automation` on the command
line) while still letting you script the browser.

> Note: `browser.close()` in Playwright, when connected over CDP, only
> closes the CDP connection. The GeekEZ Browser window keeps running.

## Setup

```bash
cd examples
npm install
```

`playwright-core` is used (no bundled browser download — we're connecting
to fingerprint-chromium, not launching a Playwright-managed one).

## Prerequisites in the app

1. Open **Settings** and turn on **🔧 Remote Debugging**. This is what
   makes the profile launcher pass `--remote-debugging-port=<n>` to
   Chrome.
2. Launch the target profile from the UI (the regular "启动" button, not
   "使用干净 profile 启动" — that mode intentionally strips the debug port
   for maximum stealth).
3. Optionally: turn on **🔌 API Server** if you want the example to open
   the profile for you.

## youtube-cdp.js

Navigates to `youtube.com`, dismisses the consent dialog if any, searches
for `lofi hip hop radio`, waits for the results grid, and takes two
screenshots (`youtube-home.png`, `youtube-results.png`). Also dumps what
the page sees for `navigator.userAgent`, `navigator.webdriver`, timezone
and screen — good sanity check that the fingerprint kernel is doing its
job.

### Three ways to run it

**A. You already launched the profile from the UI.** Grab the port
   printed in the app console (or from the profile's remote-debugging
   badge) and pass it:

   ```bash
   node youtube-cdp.js --port=9222
   ```

**B. Let the API open an existing profile for you.**

   ```bash
   node youtube-cdp.js --profile=my-profile
   ```

   The script hits `GET http://127.0.0.1:12138/api/open/my-profile`,
   reads the `remote port` from the response, then connects.

**C. Create the profile on the fly with a specific proxy, then open.**

   ```bash
   node youtube-cdp.js --profile=demo-yt --proxy=socks5://127.0.0.1:7890
   ```

   The script first calls `POST /api/profiles` with the given proxy
   string (only if the profile doesn't already exist), then falls through
   to path B to open it. Response fields used:

   - `remoteDebugPort` in the `POST /api/profiles` response — assigned at
     creation time, stable for the profile's lifetime. The script logs it
     so you can watch it come back the same on every launch.
   - `remote port` in the `GET /api/open/…` response — same number,
     confirmed live after Chrome bound the port.

Override the API port with `--api-port=<n>` (or `GEEKEZ_API_PORT`).
Environment variable equivalents for CI use:
`GEEKEZ_CDP_PORT`, `GEEKEZ_PROFILE`, `GEEKEZ_PROXY`, `GEEKEZ_API_PORT`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Chrome DevTools endpoint on port … never responded` | Remote Debugging is off, or you launched with "clean profile" (which disables the debug port on purpose). |
| `API launched the profile but returned no "remote port"` | Same as above, but through the API path. |
| `ECONNREFUSED 127.0.0.1:12138` | GeekEZ API server is off. Turn on **🔌 API Server** in Settings, or launch the profile from the UI first and use `--port=…`. |
| Playwright hangs after `connectOverCDP` | The profile isn't fully alive yet. Give it a couple of seconds after launch, or use the API path which waits for the port itself. |
