import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.js'),
          'chromium-path': resolve(__dirname, 'src/main/chromium-path.js'),
          'close-behavior': resolve(__dirname, 'src/main/close-behavior.js'),
          'singbox-assets': resolve(__dirname, 'src/main/singbox-assets.js'),
          'cdp-cookie-client': resolve(__dirname, 'src/main/cdp-cookie-client.js'),
          'cookie-formats': resolve(__dirname, 'src/main/cookie-formats.js'),
          'release-check': resolve(__dirname, 'src/main/release-check.js'),
          'profile-db': resolve(__dirname, 'src/main/profile-db.js'),
          'db/config': resolve(__dirname, 'src/main/db/config.js'),
          'db/factory': resolve(__dirname, 'src/main/db/factory.js'),
          'db/schema-sqlite': resolve(__dirname, 'src/main/db/schema-sqlite.js'),
          'db/schema-pg': resolve(__dirname, 'src/main/db/schema-pg.js'),
          'db/schema-mysql': resolve(__dirname, 'src/main/db/schema-mysql.js')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.js')
        }
      }
    }
  },
  renderer: {
    server: {
      host: '127.0.0.1',
      port: 15173,
      strictPort: true
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
