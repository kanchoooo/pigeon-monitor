import { BrowserWindow, ipcMain, screen, type Display, type IpcMainEvent } from 'electron'
import type { OverlayCommand, OverlayConfig, OverlayReport, PerchUpdate, Presence, Settings } from '@shared/types'
import { env, isHeadless, loadRenderer, preloadPath } from './env'
import { computePerches } from './perches'
import { listWindows, type WinRect } from './windows'
import { createPressReader, type Presses } from './windows/buttons'

/**
 * 디스플레이마다 하나씩 띄우는 투명 전체화면 창.
 * 평소에는 클릭이 아래로 통과하고(setIgnoreMouseEvents), 커서가 비둘기 위에 있거나
 * 모이 주는 중일 때만 클릭을 받는다. 할 일이 없으면 숨긴다.
 * 클릭을 받는 동안의 버튼 누름은 메인이 직접 읽어서도 알려 준다 (windows/buttons.ts 참고).
 */
interface Item {
  id: number
  display: Display
  win: BrowserWindow
  ready: boolean
  busy: boolean
  pigeons: number
  /** 명령을 보낸 직후 잠깐 보이게 (렌더러가 비둘기를 만들 시간) */
  wakeUntil: number
  blocked: boolean
  fullscreen: boolean
  nativeId: number
  perchKey: string
  cursorKey: string
  /** 지금 클릭을 받는 중 (클릭 통과 아님) */
  interactive: boolean
}

export interface OverlayState {
  /** 쉬는 중 — 새 비둘기가 오지 않는다 (전체화면은 디스플레이별로 따로) */
  paused: boolean
  /** 화면 잠금 — 오버레이를 숨겨 비둘기를 그 자리에 멈춰 둔다 */
  locked: boolean
  settings: Settings
}

const HEADLESS_SIZE = { width: 1440, height: 900 }

export class Overlays {
  private items = new Map<number, Item>()
  feeding = false
  private presence: Presence = { away: false, idle: 0 }
  private cursorTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private fakeWins: WinRect[] | null = null
  /** 패널 창도 앉을 자리에 포함하려고, 오버레이 창만 뺀다 */
  private exclude = new Set<number>()
  private presses: (() => Presses) | null | undefined

  constructor(
    private state: () => OverlayState,
    private onReport: (displayId: number, r: OverlayReport) => void
  ) {
    ipcMain.on('overlay:ready', (e) => {
      const it = this.itemOf(e)
      if (!it) return
      it.ready = true
      this.sendInit(it)
    })
    ipcMain.on('overlay:interactive', (e, on: boolean) => {
      const it = this.itemOf(e)
      if (!it || it.win.isDestroyed()) return
      it.interactive = on
      if (on) it.win.setIgnoreMouseEvents(false)
      else it.win.setIgnoreMouseEvents(true, { forward: true })
    })
    ipcMain.on('overlay:report', (e, r: OverlayReport) => {
      const it = this.itemOf(e)
      if (!it) return
      if (r.type === 'status') {
        it.busy = !!r.busy
        it.pigeons = Number(r.pigeons) || 0
        this.refresh(it)
        this.schedulePoll(0)
      }
      this.onReport(it.id, r)
    })
    if (isHeadless()) {
      try {
        this.fakeWins = env.PIGEON_FAKE_WINDOWS ? (JSON.parse(env.PIGEON_FAKE_WINDOWS) as WinRect[]) : DEFAULT_FAKE_WINDOWS
      } catch {
        this.fakeWins = DEFAULT_FAKE_WINDOWS
      }
    } else {
      screen.on('display-added', () => this.sync())
      screen.on('display-removed', () => this.sync())
      screen.on('display-metrics-changed', () => this.sync())
    }
  }

  private itemOf(e: IpcMainEvent): Item | undefined {
    for (const it of this.items.values()) if (!it.win.isDestroyed() && it.win.webContents.id === e.sender.id) return it
    return undefined
  }

  get pigeons(): number {
    let n = 0
    for (const it of this.items.values()) n += it.pigeons
    return n
  }

  /** 테스트 자동화용 */
  get first(): BrowserWindow | null {
    return [...this.items.values()][0]?.win ?? null
  }

  private displays(): Display[] {
    if (isHeadless()) {
      const b = { x: 0, y: 0, ...HEADLESS_SIZE }
      return [{ id: 1, bounds: b, workArea: { ...b, height: b.height - 48 }, size: HEADLESS_SIZE, workAreaSize: HEADLESS_SIZE, scaleFactor: 1 } as unknown as Display]
    }
    return screen.getAllDisplays()
  }

  /** 디스플레이 구성에 맞춰 창을 만들고 없앤다 */
  sync(): void {
    const ds = this.displays()
    const ids = new Set(ds.map((d) => d.id))
    for (const [id, it] of this.items) {
      if (!ids.has(id)) {
        if (!it.win.isDestroyed()) it.win.destroy()
        this.items.delete(id)
      }
    }
    for (const d of ds) {
      const it = this.items.get(d.id)
      if (!it) this.create(d)
      else {
        const moved = JSON.stringify(it.display.bounds) !== JSON.stringify(d.bounds)
        it.display = d
        if (moved && !it.win.isDestroyed()) {
          it.win.setBounds(d.bounds)
          this.sendInit(it)
        }
      }
    }
    this.pushConfig()
    this.schedulePoll(0)
  }

  private create(d: Display): void {
    const isMac = process.platform === 'darwin'
    const headless = isHeadless()
    const b = d.bounds
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      acceptFirstMouse: true,
      ...(isMac ? { type: 'panel' } : { type: 'toolbar' }),
      webPreferences: {
        preload: preloadPath('overlay'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        offscreen: headless
      }
    })
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.webContents.on('console-message', (e) => {
      if (env.PIGEON_LOG === '1') console.log(`[overlay ${d.id}:${e.level}] ${e.message}`)
    })
    const it: Item = {
      id: d.id,
      display: d,
      win,
      ready: false,
      busy: false,
      pigeons: 0,
      wakeUntil: 0,
      blocked: false,
      fullscreen: false,
      nativeId: 0,
      perchKey: '',
      cursorKey: '',
      interactive: false
    }
    it.nativeId = nativeWindowId(win)
    if (it.nativeId) this.exclude.add(it.nativeId)
    win.on('closed', () => {
      this.exclude.delete(it.nativeId)
      if (this.items.get(d.id) === it) this.items.delete(d.id)
    })
    loadRenderer(win, 'overlay', { query: headless || env.PIGEON_DEBUG_BG === '1' ? { debug: '1' } : undefined })
    this.items.set(d.id, it)
  }

  private sendInit(it: Item): void {
    if (!it.ready || it.win.isDestroyed()) return
    it.win.webContents.send('world:init', { width: it.display.bounds.width, height: it.display.bounds.height })
    it.win.webContents.send('world:config', this.configFor(it))
    it.win.webContents.send('world:presence', this.presence)
    it.win.webContents.send('world:feed', this.feeding)
    it.perchKey = ''
    this.poll()
  }

  private configFor(it: Item): OverlayConfig {
    const s = this.state().settings
    const ds = [...this.items.values()]
    const area = (d: Display): number => d.bounds.width * d.bounds.height
    const total = ds.reduce((a, x) => a + area(x.display), 0) || 1
    const quota = ds.length <= 1 ? s.maxPigeons : Math.max(1, Math.round((s.maxPigeons * area(it.display)) / total))
    return { sound: s.sound, bubbles: s.bubbles, size: s.size, quota }
  }

  pushConfig(): void {
    for (const it of this.items.values()) if (it.ready && !it.win.isDestroyed()) it.win.webContents.send('world:config', this.configFor(it))
    this.poll()
  }

  setPresence(p: Presence): void {
    const changed = p.away !== this.presence.away
    this.presence = p
    if (!changed) return
    for (const it of this.items.values()) if (it.ready && !it.win.isDestroyed()) it.win.webContents.send('world:presence', p)
    this.poll()
    this.refreshAll()
    this.schedulePoll(0)
  }

  setFeeding(on: boolean): void {
    this.feeding = on
    for (const it of this.items.values()) {
      if (it.win.isDestroyed()) continue
      if (it.ready) it.win.webContents.send('world:feed', on)
      // 끝낼 때는 렌더러를 기다리지 않고 바로 클릭 통과로 되돌린다 (비둘기 위에서는 렌더러가 다시 켠다)
      it.interactive = on
      if (on) it.win.setIgnoreMouseEvents(false)
      else it.win.setIgnoreMouseEvents(true, { forward: true })
    }
    this.refreshAll()
    this.schedulePoll(0)
  }

  /** 커서가 있는 화면(없으면 첫 화면)에 명령 */
  commandNearCursor(cmd: OverlayCommand): void {
    const d = isHeadless() ? this.displays()[0] : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const it = this.items.get(d.id) ?? [...this.items.values()][0]
    if (it) this.command(it.id, cmd)
  }

  command(displayId: number, cmd: OverlayCommand): void {
    const it = this.items.get(displayId)
    if (!it || it.win.isDestroyed()) return
    if (cmd.type === 'summon' || cmd.type === 'release') {
      it.wakeUntil = Date.now() + 6000
      this.refresh(it)
    }
    it.win.webContents.send('world:command', cmd)
    this.schedulePoll(0)
  }

  commandAll(cmd: OverlayCommand): void {
    for (const it of this.items.values()) this.command(it.id, cmd)
  }

  // ───────── 보이기·숨기기 ─────────

  private wants(it: Item): boolean {
    if (this.state().locked) return false
    return this.feeding || it.busy || it.wakeUntil > Date.now() || (this.presence.away && !it.blocked)
  }

  private refresh(it: Item): void {
    if (it.win.isDestroyed()) return
    const want = this.wants(it)
    const visible = it.win.isVisible()
    if (want && !visible) {
      if (!isHeadless()) {
        it.win.setBounds(it.display.bounds)
        it.win.setAlwaysOnTop(true, 'screen-saver')
      }
      it.win.showInactive()
      if (!isHeadless()) it.win.moveTop()
    } else if (!want && visible) {
      it.interactive = false
      it.win.setIgnoreMouseEvents(true, { forward: true })
      it.win.hide()
    }
    this.updateCursorLoop()
  }

  refreshAll(): void {
    for (const it of this.items.values()) this.refresh(it)
  }

  // ───────── 커서 (60Hz, 보일 때만) ─────────

  private updateCursorLoop(): void {
    const any = [...this.items.values()].some((it) => !it.win.isDestroyed() && it.win.isVisible())
    if (any && !this.cursorTimer && !isHeadless()) {
      if (this.presses === undefined) this.presses = createPressReader()
      this.presses?.() // 이전 상태를 비운다
      this.cursorTimer = setInterval(() => this.sendCursor(), 16)
    } else if (!any && this.cursorTimer) {
      clearInterval(this.cursorTimer)
      this.cursorTimer = null
    }
  }

  private sendCursor(): void {
    const c = screen.getCursorScreenPoint()
    for (const it of this.items.values()) {
      if (!it.ready || it.win.isDestroyed() || !it.win.isVisible()) continue
      const x = c.x - it.display.bounds.x
      const y = c.y - it.display.bounds.y
      const key = `${x},${y}`
      if (key === it.cursorKey) continue
      it.cursorKey = key
      it.win.webContents.send('world:cursor', { x, y })
    }
    // 클릭을 받는 중인 화면에서 버튼이 눌렸으면 알려 준다
    const p = this.presses?.()
    if (!p || (!p.left && !p.right)) return
    for (const it of this.items.values()) {
      if (!it.ready || it.win.isDestroyed() || !it.win.isVisible() || !it.interactive) continue
      const b = it.display.bounds
      if (c.x < b.x || c.y < b.y || c.x >= b.x + b.width || c.y >= b.y + b.height) continue
      it.win.webContents.send('world:press', { x: c.x - b.x, y: c.y - b.y, button: p.left ? 0 : 2 })
    }
  }

  /** 테스트 자동화: 가짜 창 바꾸기 */
  setFakeWindows(list: WinRect[]): void {
    this.fakeWins = list
    this.poll()
  }

  /** 테스트 자동화: 가짜 커서 */
  sendFakeCursor(x: number, y: number): void {
    for (const it of this.items.values()) if (it.ready) it.win.webContents.send('world:cursor', { x, y })
  }

  // ───────── 창 위치 → 앉을 자리 ─────────

  /** 비둘기가 있으면 자주(창을 끌면 같이 움직이도록), 자리비움 중이면 가끔, 아니면 쉰다 */
  private pollDelay(): number | null {
    const active = this.feeding || [...this.items.values()].some((it) => it.busy)
    if (active) return this.presence.away ? 600 : 120
    if (this.presence.away) return 1000
    return null
  }

  private schedulePoll(delay: number | null = this.pollDelay()): void {
    if (delay === null) return
    if (this.pollTimer) {
      if (delay > 0) return
      clearTimeout(this.pollTimer)
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      this.poll()
      this.schedulePoll()
    }, delay)
  }

  poll(): void {
    const st = this.state()
    const wins = this.fakeWins ?? listWindows()
    for (const it of this.items.values()) {
      if (it.win.isDestroyed()) continue
      const { perches, fullscreen } = computePerches(wins, it.display, this.exclude)
      it.fullscreen = fullscreen
      const blocked = st.paused || (st.settings.skipFullscreen && fullscreen)
      const changedBlock = blocked !== it.blocked
      it.blocked = blocked
      const upd: PerchUpdate = { perches, blocked }
      const key = JSON.stringify(upd)
      if (key !== it.perchKey && it.ready) {
        it.perchKey = key
        it.win.webContents.send('world:perches', upd)
      }
      if (changedBlock) this.refresh(it)
    }
  }

  destroy(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer)
    if (this.pollTimer) clearTimeout(this.pollTimer)
    for (const it of this.items.values()) if (!it.win.isDestroyed()) it.win.destroy()
    this.items.clear()
  }
}

/** 창 목록에서 이 창을 찾기 위한 번호 (맥: CGWindowID, 윈도우: HWND) */
export function nativeWindowId(win: BrowserWindow): number {
  try {
    if (process.platform === 'win32') {
      const h = win.getNativeWindowHandle()
      return Number(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0))
    }
    const m = /^window:(\d+):/.exec(win.getMediaSourceId())
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}

/** 헤드리스 테스트용 가짜 창 (앞 → 뒤) */
const DEFAULT_FAKE_WINDOWS: WinRect[] = [
  { id: 101, pid: 1, x: 860, y: 260, w: 460, h: 380 },
  { id: 102, pid: 1, x: 120, y: 180, w: 620, h: 460 },
  { id: 103, pid: 1, x: 600, y: 120, w: 520, h: 300 }
]
