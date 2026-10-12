import type { OverlayApi, PanelApi } from '@shared/types'

declare global {
  interface Window {
    api: PanelApi
    overlayApi: OverlayApi
  }
}

export {}
