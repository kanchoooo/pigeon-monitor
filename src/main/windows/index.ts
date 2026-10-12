// 다른 앱 창의 위치 읽기 (비둘기가 창 위에 앉도록). 실패하면 화면 바닥에만 앉는다.
import { screen } from 'electron'
import { createMacLister } from './mac'
import { createWinLister } from './win'

/** 화면 좌표(DIP) 기준 창 사각형. 목록은 앞(위) → 뒤 순서 */
export interface WinRect {
  id: number
  pid: number
  x: number
  y: number
  w: number
  h: number
}

let lister: (() => WinRect[]) | null | undefined
let failures = 0

function init(): (() => WinRect[]) | null {
  try {
    if (process.platform === 'darwin') return createMacLister()
    if (process.platform === 'win32') {
      const raw = createWinLister()
      // 물리 픽셀 → DIP (모니터마다 배율이 다를 수 있다)
      return () =>
        raw().map((r) => {
          const d = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h })
          return { ...r, x: d.x, y: d.y, w: d.width, h: d.height }
        })
    }
  } catch (err) {
    console.warn('[windows] 창 목록을 읽을 수 없어 바닥에만 앉습니다:', (err as Error)?.message ?? err)
  }
  return null
}

export function listWindows(): WinRect[] {
  if (lister === undefined) lister = init()
  if (!lister) return []
  try {
    const r = lister()
    failures = 0
    return r
  } catch (err) {
    if (++failures === 1 || failures % 100 === 0) console.warn('[windows] 창 목록 실패', (err as Error)?.message ?? err)
    if (failures > 500) lister = null
    return []
  }
}
