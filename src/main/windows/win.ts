// Windows: user32 로 창을 위(앞) → 아래(뒤) 순서로 훑어 보이는 창의 위치를 읽는다.
// 좌표는 물리 픽셀 — index.ts 에서 DIP 로 바꾼다.
import koffi from 'koffi'
import type { WinRect } from './index'

const GW_HWNDNEXT = 2
const GWL_EXSTYLE = -20
const WS_EX_TRANSPARENT = 0x20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000
const WS_EX_APPWINDOW = 0x40000
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14

// 바탕화면·작업 표시줄·시작 메뉴 같은 셸 창은 앉을 자리에서 뺀다
const SKIP_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'Xaml_WindowedPopupClass',
  'ForegroundStaging',
  'MultitaskingViewFrame',
  'EdgeUiInputTopWndClass',
  'tooltips_class32',
  'IME',
  'MSCTFIME UI'
])

export function createWinLister(): () => WinRect[] {
  const user32 = koffi.load('user32.dll')
  const dwm = koffi.load('dwmapi.dll')
  koffi.struct('PgRECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
  const GetTopWindow = user32.func('void *__stdcall GetTopWindow(void *hWnd)')
  const GetWindow = user32.func('void *__stdcall GetWindow(void *hWnd, uint32_t uCmd)')
  const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hWnd)')
  const IsIconic = user32.func('int __stdcall IsIconic(void *hWnd)')
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)')
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ PgRECT *rect)')
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hWnd, _Out_ uint8_t *buf, int maxCount)')
  const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)')
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *pid)')
  const DwmGetWindowAttribute = dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ uint8_t *pv, uint32_t cb)')

  const cls = Buffer.alloc(512)
  const cloak = Buffer.alloc(4)
  const frame = Buffer.alloc(16)
  const pid = [0]

  return () => {
    const list: WinRect[] = []
    let h = GetTopWindow(null)
    for (let guard = 0; h && guard < 2000; guard++, h = GetWindow(h, GW_HWNDNEXT)) {
      if (!IsWindowVisible(h) || IsIconic(h)) continue
      const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE))
      if (ex & WS_EX_TRANSPARENT) continue
      if (ex & WS_EX_TOOLWINDOW && !(ex & WS_EX_APPWINDOW)) continue
      if (ex & WS_EX_NOACTIVATE && !(ex & WS_EX_APPWINDOW)) continue
      cloak.writeInt32LE(0, 0)
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, cloak, 4) === 0 && cloak.readInt32LE(0) !== 0) continue
      if (GetWindowTextLengthW(h) <= 0) continue
      const n = GetClassNameW(h, cls, 256)
      if (n > 0 && SKIP_CLASSES.has(cls.toString('utf16le', 0, n * 2))) continue
      let x: number, y: number, w: number, hh: number
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16) === 0) {
        x = frame.readInt32LE(0)
        y = frame.readInt32LE(4)
        w = frame.readInt32LE(8) - x
        hh = frame.readInt32LE(12) - y
      } else {
        const r = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!GetWindowRect(h, r)) continue
        x = r.left
        y = r.top
        w = r.right - r.left
        hh = r.bottom - r.top
      }
      if (w < 120 || hh < 60) continue
      GetWindowThreadProcessId(h, pid)
      list.push({ id: Number(h), pid: pid[0], x, y, w, h: hh })
    }
    return list
  }
}
