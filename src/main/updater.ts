import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/** 패키징된 앱에서만 자동 업데이트를 확인한다 (electron-builder publish 설정 사용) */
export function setupUpdater(): void {
  if (!app.isPackaged || process.env.PIGEON_NO_UPDATE === '1') return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.warn('[updater]', err?.message ?? err))
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] check failed', err?.message ?? err))
  }
  setTimeout(check, 15_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
