import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayApi } from '@shared/types'

function on<T>(channel: string, cb: (v: T) => void): void {
  ipcRenderer.on(channel, (_e, v: T) => cb(v))
}

const api: OverlayApi = {
  platform: process.platform,
  onInit: (cb) => on('world:init', cb),
  onPerches: (cb) => on('world:perches', cb),
  onCursor: (cb) => on('world:cursor', cb),
  onPresence: (cb) => on('world:presence', cb),
  onConfig: (cb) => on('world:config', cb),
  onFeed: (cb) => on('world:feed', cb),
  onCommand: (cb) => on('world:command', cb),
  onPress: (cb) => on('world:press', cb),
  setInteractive: (v) => ipcRenderer.send('overlay:interactive', v),
  report: (r) => ipcRenderer.send('overlay:report', r),
  ready: () => ipcRenderer.send('overlay:ready')
}

contextBridge.exposeInMainWorld('overlayApi', api)
