# Release v1.2.4

## 🔧 Bug Fixes

### Protocol Support
- **VLESS xhttp**: Added `mode` parameter support (default: `stream-up`)
- **Shadowsocks**: Fixed configuration format
  - Added `ota`, `level` parameters
  - Added `streamSettings` (tcp network)
  - Added `mux` configuration for v2rayN compatibility
- **Shadowsocks-2022**: Verified password encoding (base64 preserved)

### UI Improvements
- **Batch Testing**: Added loading indicators (`...`) on individual node buttons during latency tests
- **Environment Watermark**: Fixed bookmark bar overlap issue
- **List View**: Fixed multi-environment display bug

## 📝 Notes
- Timezone spoofing functionality maintained from v1.2.3
- All changes tested on working timezone base (commit 463e51c)
