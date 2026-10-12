// 마우스 버튼 누름 감지 (60Hz 로 읽는다).
// 윈도우에서는 포커스를 받지 않는 창(오버레이)이 클릭을 받으면 Chromium 이 그 클릭을 버려서
// (WM_MOUSEACTIVATE → MA_NOACTIVATEANDEAT) 렌더러에 pointerdown 이 오지 않는다.
// 그래서 버튼 상태를 직접 읽어 오버레이에 알려 준다. 맥은 보통 클릭이 오지만 같은 길을 보험으로 쓴다.
import koffi from 'koffi'

export interface Presses {
  left: boolean
  right: boolean
}

/** 지난번 호출 이후 새로 눌린 버튼. 읽을 수 없으면 null */
export function createPressReader(): (() => Presses) | null {
  try {
    if (process.platform === 'win32') return winReader()
    if (process.platform === 'darwin') return macReader()
  } catch (err) {
    console.warn('[buttons] 마우스 버튼을 읽을 수 없어요:', (err as Error)?.message ?? err)
  }
  return null
}

function winReader(): () => Presses {
  const user32 = koffi.load('user32.dll')
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)')
  const SM_SWAPBUTTON = 23
  const was = { l: false, r: false }
  // 가장 높은 비트: 지금 눌려 있음, 가장 낮은 비트: 지난 호출 이후 눌렸다 뗌 (아주 짧은 클릭)
  const read = (vk: number, prev: boolean): [boolean, boolean] => {
    const s = GetAsyncKeyState(vk) as number
    const down = (s & 0x8000) !== 0
    const quick = (s & 1) !== 0
    return [down, (down && !prev) || (!down && !prev && quick)]
  }
  return () => {
    // 물리 버튼 기준이라 '왼손잡이(버튼 바꾸기)' 설정을 반영한다
    const swap = GetSystemMetrics(SM_SWAPBUTTON) !== 0
    const [l, pl] = read(swap ? 0x02 : 0x01, was.l)
    const [r, pr] = read(swap ? 0x01 : 0x02, was.r)
    was.l = l
    was.r = r
    return { left: pl, right: pr }
  }
}

function macReader(): () => Presses {
  const objc = koffi.load('/usr/lib/libobjc.A.dylib')
  const objc_getClass = objc.func('void *objc_getClass(const char *name)')
  const sel_registerName = objc.func('void *sel_registerName(const char *name)')
  const msgSend = objc.func('uint64_t objc_msgSend(void *self, void *op)')
  const NSEvent = objc_getClass('NSEvent')
  const sel = sel_registerName('pressedMouseButtons')
  if (!NSEvent || !sel) throw new Error('NSEvent 없음')
  const was = { l: false, r: false }
  return () => {
    // 권한 없이 읽을 수 있는 현재 눌린 버튼 (bit0 = 왼쪽, bit1 = 오른쪽)
    const m = Number(msgSend(NSEvent, sel))
    const l = (m & 1) !== 0
    const r = (m & 2) !== 0
    const out = { left: l && !was.l, right: r && !was.r }
    was.l = l
    was.r = r
    return out
  }
}
