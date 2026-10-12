// macOS: CoreGraphics 로 화면에 보이는 창 목록(앞 → 뒤 순서)과 위치를 읽는다.
// 창 위치·크기는 화면 기록 권한 없이 읽을 수 있다 (창 제목은 읽지 않는다).
import koffi from 'koffi'
import type { WinRect } from './index'

const kCGWindowListOptionOnScreenOnly = 1 << 0
const kCGWindowListExcludeDesktopElements = 1 << 4
const kCFStringEncodingUTF8 = 0x08000100
const kCFNumberDoubleType = 13

export function createMacLister(): () => WinRect[] {
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  koffi.struct('PgCGRect', { x: 'double', y: 'double', w: 'double', h: 'double' })
  const CGWindowListCopyWindowInfo = CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)')
  const CGRectMakeWithDictionaryRepresentation = CG.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ PgCGRect *rect)')
  const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)')
  const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long idx)')
  const CFDictionaryGetValue = CF.func('void *CFDictionaryGetValue(void *dict, void *key)')
  const CFNumberGetValue = CF.func('bool CFNumberGetValue(void *num, int type, _Out_ double *out)')
  const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t enc)')
  const CFRelease = CF.func('void CFRelease(void *ref)')

  // 사전 키 (프로세스가 끝날 때까지 쓰므로 해제하지 않는다)
  const key = (s: string): unknown => CFStringCreateWithCString(null, s, kCFStringEncodingUTF8)
  const K = {
    num: key('kCGWindowNumber'),
    layer: key('kCGWindowLayer'),
    bounds: key('kCGWindowBounds'),
    pid: key('kCGWindowOwnerPID'),
    alpha: key('kCGWindowAlpha')
  }
  const out = [0]
  const num = (d: unknown, k: unknown): number => {
    const v = CFDictionaryGetValue(d, k)
    if (!v) return NaN
    out[0] = NaN
    return CFNumberGetValue(v, kCFNumberDoubleType, out) ? out[0] : NaN
  }

  return () => {
    const arr = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, 0)
    if (!arr) return []
    try {
      const n = Number(CFArrayGetCount(arr))
      const list: WinRect[] = []
      for (let i = 0; i < n; i++) {
        const d = CFArrayGetValueAtIndex(arr, i)
        if (!d) continue
        // 일반 앱 창만 (메뉴 막대·Dock·알림·팝업은 레이어가 0 이 아니다)
        if (num(d, K.layer) !== 0) continue
        const alpha = num(d, K.alpha)
        if (!Number.isNaN(alpha) && alpha < 0.2) continue
        const b = CFDictionaryGetValue(d, K.bounds)
        if (!b) continue
        const r = { x: 0, y: 0, w: 0, h: 0 }
        if (!CGRectMakeWithDictionaryRepresentation(b, r)) continue
        list.push({ id: num(d, K.num), pid: num(d, K.pid), x: r.x, y: r.y, w: r.w, h: r.h })
      }
      return list
    } finally {
      CFRelease(arr)
    }
  }
}
