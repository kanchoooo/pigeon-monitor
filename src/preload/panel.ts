import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { LiveStatus, PanelApi, PersistedState } from '@shared/types'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: PanelApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  setSettings: (patch) => ipcRenderer.invoke('state:setSettings', patch),
  setOnboarded: () => ipcRenderer.invoke('state:setOnboarded'),
  onState: (cb) => on<PersistedState>('state:changed', cb),
  getLive: () => ipcRenderer.invoke('live:get'),
  onLive: (cb) => on<LiveStatus>('live:changed', cb),
  feed: (v) => ipcRenderer.invoke('pigeon:feed', v),
  summon: () => ipcRenderer.invoke('pigeon:summon'),
  shooAll: () => ipcRenderer.invoke('pigeon:shooAll'),
  release: (breed) => ipcRenderer.invoke('pigeon:release', breed),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('app:saveImage', dataUrl, name),
  saveVideo: (data, ext, name) => ipcRenderer.invoke('app:saveVideo', data, ext, name),
  getReplay: (id) => ipcRenderer.invoke('album:get', id),
  deleteReplay: (id) => ipcRenderer.invoke('album:delete', id),
  setRecording: (on) => ipcRenderer.invoke('app:recording', on),
  version: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
