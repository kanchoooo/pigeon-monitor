import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          panel: resolve('src/preload/panel.ts'),
          overlay: resolve('src/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    build: {
      rollupOptions: {
        input: {
          panel: resolve('src/renderer/panel.html'),
          overlay: resolve('src/renderer/overlay.html'),
          lab: resolve('src/renderer/lab.html')
        }
      }
    }
  }
})
