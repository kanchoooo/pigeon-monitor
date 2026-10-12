import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BREED, type BreedId } from '@shared/breeds'
import { validReplay } from '@shared/replay'
import type { LiveStatus, OverlayReport, Presence, Settings } from '@shared/types'
import { env, isHeadless, loadRenderer, preloadPath } from './env'
import { trayIcon } from './icons'
import { Overlays } from './overlays'
import { Store } from './store'
import { setupUpdater } from './updater'
import { listWindows } from './windows'
import { createPressReader } from './windows/buttons'

if (process.platform === 'win32') app.setAppUserModelId('com.pigeonmonitor.app')
const headless = isHeadless()
// 테스트는 실제 데이터와 섞이지 않게 따로 저장
if (env.PIGEON_USERDATA) app.setPath('userData', env.PIGEON_USERDATA)
else if (headless) app.setPath('userData', join(app.getPath('temp'), 'pigeon-monitor-test'))
const labMode = env.PIGEON_LAB

// 한 번만 실행 (테스트 모드는 예외)
if (!headless && !labMode && !app.requestSingleInstanceLock()) app.quit()

let panel: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store
let overlays: Overlays
let quitting = false
let locked = false
let feeding = false
let lastFeedAt = 0
let feedWatch: NodeJS.Timeout | null = null
let escOn = false
let forceAway: boolean | null = env.PIGEON_FORCE_AWAY === '1' ? true : null
let presence: Presence = { away: false, idle: 0 }
let wasPaused = false
let toldAboutTray = false
/** 잡힌 비둘기 → 리플레이가 도착하면 '처음 잡은 품종인지'를 같이 저장 */
const pendingNew = new Map<string, boolean>()
const startHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)

const paused = (): boolean => store.state.settings.pausedUntil > Date.now()
const idleThreshold = (): number => (env.PIGEON_IDLE ? Number(env.PIGEON_IDLE) : store.state.settings.idleSeconds)

// ───────── 상태 알림 ─────────

function live(): LiveStatus {
  return { pigeons: overlays?.pigeons ?? 0, feeding, away: presence.away, idle: presence.idle, paused: paused() }
}

let trayKey = ''
function pushLive(): void {
  const l = live()
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.webContents.send('live:changed', l)
  const key = `${l.pigeons}|${l.feeding}|${l.paused}|${l.away}`
  if (key !== trayKey) {
    trayKey = key
    buildTrayMenu()
  }
}

/** 마우스·키보드 입력이 없는 시간으로 자리비움을 판단한다 (1초마다) */
function tickPresence(): void {
  const idle = headless ? 0 : powerMonitor.getSystemIdleTime()
  const away = forceAway ?? (!paused() && (locked || idle >= idleThreshold()))
  presence = { away: away && !paused(), idle }
  overlays.setPresence(presence)
  if (wasPaused && !paused()) {
    wasPaused = false
    overlays.poll()
  }
  pushLive()
}

// ───────── 모이 주기 ─────────

function setFeeding(on: boolean): void {
  if (on === feeding) return
  feeding = on
  overlays.setFeeding(on)
  if (on) {
    lastFeedAt = Date.now()
    if (!escOn) {
      try {
        escOn = globalShortcut.register('Escape', () => setFeeding(false))
      } catch {
        escOn = false
      }
    }
    // 안전장치: 1분 30초 동안 모이를 안 주면 저절로 끝 (클릭이 계속 막히지 않도록)
    feedWatch = setInterval(() => {
      if (Date.now() - lastFeedAt > 90_000) setFeeding(false)
    }, 5000)
  } else {
    if (escOn) globalShortcut.unregister('Escape')
    escOn = false
    if (feedWatch) clearInterval(feedWatch)
    feedWatch = null
  }
  pushLive()
  buildTrayMenu()
}

function summon(): void {
  overlays.commandNearCursor({ type: 'summon', count: 3 + Math.floor(Math.random() * 2) })
}

function shooAll(): void {
  setFeeding(false)
  overlays.commandAll({ type: 'shooAll' })
}

function pauseFor(ms: number): void {
  store.setSettings({ pausedUntil: ms > 0 ? Date.now() + ms : 0 })
}

function onReport(displayId: number, r: OverlayReport): void {
  switch (r.type) {
    case 'status':
      pushLive()
      break
    case 'caught': {
      if (!(r.breed in BREED)) return
      const res = store.addCaught(r.breed)
      if (env.PIGEON_SCRIPT) console.log('[caught]', r.breed, JSON.stringify(res))
      if (r.rid) {
        pendingNew.set(r.rid, res.isNew)
        if (pendingNew.size > 20) pendingNew.delete(pendingNew.keys().next().value!)
      }
      overlays.command(displayId, { type: 'caughtInfo', breed: r.breed, isNew: res.isNew, count: res.count })
      break
    }
    case 'replay': {
      const rp = r.replay
      if (!validReplay(rp) || !(rp.breed in BREED)) return
      store.addReplay(rp, pendingNew.get(rp.id) ?? false)
      pendingNew.delete(rp.id)
      if (env.PIGEON_SCRIPT) console.log('[replay]', rp.id, rp.breed, rp.frames.length, 'frames', rp.hits.length, 'hits')
      break
    }
    case 'arrived':
      store.bump('visits')
      break
    case 'fed':
      lastFeedAt = Date.now()
      store.bump('fed')
      break
    case 'shooed':
      store.bump('shooed')
      break
    case 'feedEnd':
      setFeeding(false)
      break
  }
}

// ───────── 패널 창 ─────────

function showPanel(): void {
  if (!panel || panel.isDestroyed()) createPanel()
  if (!panel) return
  if (process.platform === 'darwin') void app.dock?.show()
  if (panel.isMinimized()) panel.restore()
  panel.show()
  panel.focus()
}

function createPanel(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 400,
    minHeight: 560,
    // 윈도우는 테두리·제목 표시줄을 빼고 내용이 440 이 되도록
    useContentSize: true,
    show: false,
    title: '비둘기 모니터',
    backgroundColor: '#f7f2e8',
    autoHideMenuBar: true,
    maximizable: false,
    fullscreenable: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } } : {}),
    webPreferences: {
      preload: preloadPath('panel'),
      sandbox: true,
      contextIsolation: true,
      offscreen: headless
    }
  })
  win.once('ready-to-show', () => {
    if (!headless && !startHidden) showPanel()
  })
  win.on('show', () => win.webContents.send('live:changed', live()))
  win.on('close', (e) => {
    if (quitting) return
    // 닫아도 트레이(메뉴 막대)에 남아 비둘기를 계속 부른다
    e.preventDefault()
    win.hide()
    if (process.platform === 'darwin') app.dock?.hide()
    else if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true
      new Notification({ title: '비둘기 모니터는 계속 실행 중이에요', body: '작업 표시줄 트레이의 비둘기 아이콘에서 다시 열 수 있어요.', silent: true }).show()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('console-message', (e) => {
    if (env.PIGEON_LOG === '1') console.log(`[panel:${e.level}] ${e.message}`)
  })
  loadRenderer(win, 'panel')
  panel = win
}

// ───────── 트레이 ─────────

function buildTrayMenu(): void {
  if (!tray || !store) return
  const s = store.state.settings
  const l = live()
  const status = l.paused
    ? `쉬는 중 (${new Date(s.pausedUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지)`
    : l.pigeons > 0
      ? `화면에 비둘기 ${l.pigeons}마리`
      : `${fmtIdle(s.idleSeconds)} 자리를 비우면 비둘기가 와요`
  const total = Object.values(store.state.caught).reduce((a, e) => a + (e?.total ?? 0), 0)
  const menu = Menu.buildFromTemplate([
    { label: '비둘기 모니터 열기', click: showPanel },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: feeding ? '🌾 모이 그만 주기 (ESC)' : '🌾 모이 주기', click: () => setFeeding(!feeding) },
    { label: '🕊 지금 비둘기 부르기', click: summon },
    { label: '💨 모두 쫓아내기', click: shooAll, enabled: l.pigeons > 0 },
    { type: 'separator' },
    { label: `생포한 비둘기 ${total}마리 · 도감 보기`, click: showPanel },
    {
      label: '잠시 쉬기',
      submenu: [
        { label: '30분', click: () => pauseFor(30 * 60_000) },
        { label: '1시간', click: () => pauseFor(60 * 60_000) },
        { label: '3시간', click: () => pauseFor(3 * 60 * 60_000) },
        { type: 'separator' },
        { label: '다시 시작', enabled: l.paused, click: () => pauseFor(0) }
      ]
    },
    { label: '효과음', type: 'checkbox', checked: s.sound, click: (i) => store.setSettings({ sound: i.checked }) },
    { label: '말풍선', type: 'checkbox', checked: s.bubbles, click: (i) => store.setSettings({ bubbles: i.checked }) },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(`비둘기 모니터 — ${status}`)
}

/** 저장 위치 묻기 (자동 테스트는 PIGEON_SAVE_DIR 에 바로 저장) */
async function askSavePath(opts: Electron.SaveDialogOptions): Promise<string | null> {
  if (env.PIGEON_SAVE_DIR && opts.defaultPath) {
    mkdirSync(env.PIGEON_SAVE_DIR, { recursive: true })
    return join(env.PIGEON_SAVE_DIR, opts.defaultPath.split(/[\\/]/).pop()!)
  }
  const r = panel && !panel.isDestroyed() ? await dialog.showSaveDialog(panel, opts) : await dialog.showSaveDialog(opts)
  return r.canceled || !r.filePath ? null : r.filePath
}

/** 저장 대화상자 기본 파일 이름 (경로 문자 빼기) */
function safeName(name: unknown, fallback: string): string {
  const s = typeof name === 'string' ? name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) : ''
  return s || fallback
}

function fmtIdle(sec: number): string {
  return sec < 60 ? `${sec}초` : `${Math.round(sec / 60)}분`
}

function createTray(): void {
  tray = new Tray(trayIcon())
  tray.on('click', () => {
    // 윈도우: 왼쪽 클릭으로 열기 / 맥: 메뉴가 뜬다
    if (process.platform !== 'darwin') showPanel()
  })
  tray.on('double-click', showPanel)
  buildTrayMenu()
}

// ───────── IPC ─────────

function registerIpc(): void {
  ipcMain.handle('state:get', () => store.state)
  ipcMain.handle('state:setSettings', (_e, patch: Partial<Settings>) => store.setSettings(patch))
  ipcMain.handle('state:setOnboarded', () => store.setOnboarded())
  ipcMain.handle('live:get', () => live())
  ipcMain.handle('pigeon:feed', (_e, on: boolean) => setFeeding(!!on))
  ipcMain.handle('pigeon:summon', () => summon())
  ipcMain.handle('pigeon:shooAll', () => shooAll())
  ipcMain.handle('pigeon:release', (_e, breed: BreedId) => {
    if (!(breed in BREED) || !store.takeOne(breed)) return false
    overlays.commandNearCursor({ type: 'release', breed })
    return true
  })
  ipcMain.handle('app:saveImage', async (_e, dataUrl: string, name?: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return 'cancel'
    const png = nativeImage.createFromDataURL(dataUrl).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]).catch((err) => console.warn('[clipboard]', err))
    const opts = {
      defaultPath: join(app.getPath('desktop'), `${safeName(name, '내-비둘기-도감')}.png`),
      filters: [{ name: 'PNG 이미지', extensions: ['png'] }]
    }
    const file = await askSavePath(opts)
    if (!file) return 'copied'
    writeFileSync(file, png)
    return 'saved'
  })
  ipcMain.handle('app:saveVideo', async (_e, data: Uint8Array, ext: string, name?: string) => {
    if (!(data instanceof Uint8Array) || data.length < 100 || data.length > 200 * 1024 * 1024) return 'cancel'
    const e = ext === 'mp4' ? 'mp4' : 'webm'
    const opts = {
      defaultPath: join(app.getPath('desktop'), `${safeName(name, '비둘기-생포')}.${e}`),
      filters: [{ name: e === 'mp4' ? 'MP4 영상' : 'WebM 영상', extensions: [e] }]
    }
    const file = await askSavePath(opts)
    if (!file) return 'cancel'
    writeFileSync(file, data)
    if (env.PIGEON_SCRIPT) console.log('[saved]', file, data.length)
    return 'saved'
  })
  ipcMain.handle('album:get', (_e, id: string) => (typeof id === 'string' ? store.getReplay(id) : null))
  ipcMain.handle('album:delete', (_e, id: string) => {
    if (typeof id === 'string') store.deleteReplay(id)
  })
  ipcMain.handle('app:recording', (e, on: boolean) => e.sender.setBackgroundThrottling(!on))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url)
  })
}

// ───────── 테스트 자동화 (환경변수로만 동작) ─────────

interface Step {
  at: number
  summon?: number
  feed?: boolean
  click?: [number, number]
  clicks?: [number, number, number]
  move?: [number, number]
  sweep?: [number, number, number, number]
  shot?: string
  /** 가짜 창 목록 바꾸기 (헤드리스) */
  windows?: { id: number; pid: number; x: number; y: number; w: number; h: number }[]
  release?: BreedId
  /** 생포 추격: 쫓기는 중 → 먹는 중 → 앉아 있는 비둘기를 따라가며 n번 클릭 ([n, 간격ms], 기본 간격 350) */
  chase?: number | [number, number]
  shoo?: boolean
  away?: boolean
  /** 메인이 읽은 버튼 누름을 흉내 (윈도우 경로) [x, y, button] */
  press?: [number, number, number]
  /** 패널에서 JS 실행 (탭 누르기 등) · 패널 캡처 */
  panelJs?: string
  panelShot?: string
  quit?: boolean
}

function runScript(): void {
  if (!env.PIGEON_SCRIPT) return
  const steps = JSON.parse(readFileSync(env.PIGEON_SCRIPT, 'utf8')) as Step[]
  const dir = env.PIGEON_SHOT_DIR ?? '.'
  mkdirSync(dir, { recursive: true })
  const ow = (): BrowserWindow | null => overlays.first
  const mouse = (type: 'mouseDown' | 'mouseUp' | 'mouseMove', x: number, y: number): void => {
    ow()?.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
  }
  for (const s of steps) {
    setTimeout(async () => {
      if (s.summon) overlays.commandAll({ type: 'summon', count: s.summon })
      if (s.feed !== undefined) setFeeding(s.feed)
      if (s.away !== undefined) {
        forceAway = s.away
        tickPresence()
      }
      if (s.shoo) shooAll()
      if (s.windows) overlays.setFakeWindows(s.windows)
      if (s.release) overlays.commandAll({ type: 'release', breed: s.release })
      if (s.move) {
        overlays.sendFakeCursor(s.move[0], s.move[1])
        mouse('mouseMove', s.move[0], s.move[1])
      }
      if (s.sweep) {
        // 커서를 빠르게 휘두르기
        const [x0, y0, x1, y1] = s.sweep
        for (let i = 0; i <= 10; i++) setTimeout(() => overlays.sendFakeCursor(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10), i * 16)
      }
      if (s.press) {
        const [x, y, button] = s.press
        overlays.sendFakeCursor(x, y)
        ow()?.webContents.send('world:press', { x, y, button })
      }
      if (s.panelJs && panel) {
        const r = await panel.webContents.executeJavaScript(s.panelJs).catch((err: Error) => `ERR ${err.message}`)
        console.log('[panelJs]', JSON.stringify(r))
      }
      if (s.panelShot && panel) {
        const img = await panel.webContents.capturePage()
        const file = join(dir, `${s.panelShot}.png`)
        writeFileSync(file, img.toPNG())
        console.log('[shot]', file)
      }
      if (s.click) {
        const [x, y] = s.click
        overlays.sendFakeCursor(x, y)
        mouse('mouseDown', x, y)
        mouse('mouseUp', x, y)
      }
      if (s.clicks) {
        const [x, y, n] = s.clicks
        overlays.sendFakeCursor(x, y)
        for (let i = 0; i < n; i++)
          setTimeout(() => {
            mouse('mouseDown', x, y)
            mouse('mouseUp', x, y)
          }, i * 110)
      }
      if (s.chase) {
        const [n, gap] = Array.isArray(s.chase) ? s.chase : [s.chase, 350]
        const find = `(() => { const w = window.__world; const p = w && (w.pigeons.find(p => p.st === 'chase') || w.pigeons.find(p => p.st === 'eat') || w.pigeons.find(p => p.grounded)); return p ? [p.center.x, p.center.y, p.st, p.breed.id, +w.now.toFixed(2), p.chase && p.chase.leg ? 'leg' : p.chase ? 'hover' : '-'] : null })()`
        for (let i = 0; i < n; i++) {
          const pt = (await ow()?.webContents.executeJavaScript(find)) as [number, number, string, string] | null
          console.log('[chase]', i + 1, JSON.stringify(pt))
          if (!pt) break
          const [x, y] = [Math.round(pt[0]), Math.round(pt[1])]
          overlays.sendFakeCursor(x, y)
          mouse('mouseDown', x, y)
          mouse('mouseUp', x, y)
          await new Promise((r) => setTimeout(r, gap))
        }
      }
      if (s.shot) {
        const w = ow()
        if (w) {
          const img = await w.webContents.capturePage()
          const file = join(dir, `${s.shot}.png`)
          writeFileSync(file, img.toPNG())
          console.log('[shot]', file)
        }
      }
      if (s.quit) {
        quitting = true
        app.quit()
      }
    }, s.at)
  }
}

function runLab(name: string): void {
  const [w, h] = (env.PIGEON_SIZE ?? '1500x1000').split('x').map(Number)
  const win = new BrowserWindow({ width: w, height: h, show: !env.PIGEON_SHOT, transparent: name === 'icon', frame: name !== 'icon', webPreferences: { offscreen: !!env.PIGEON_SHOT } })
  loadRenderer(win, 'lab', { hash: name })
  if (env.PIGEON_SHOT) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        if (name === 'icon') {
          // 투명 모서리를 살리려고 캔버스 그대로 저장
          const url = (await win.webContents.executeJavaScript(`document.querySelector('canvas').toDataURL('image/png')`)) as string
          writeFileSync(env.PIGEON_SHOT!, Buffer.from(url.split(',')[1], 'base64'))
        } else {
          const img = await win.webContents.capturePage()
          writeFileSync(env.PIGEON_SHOT!, img.toPNG())
        }
        app.quit()
      }, Number(env.PIGEON_SHOT_DELAY ?? 800))
    )
  }
}

// ───────── 시작 ─────────

app.on('second-instance', () => showPanel())

app.whenReady().then(() => {
  if (labMode) return runLab(labMode)
  if (env.PIGEON_SELFTEST === '1') {
    // 패키징 확인: 창 목록(koffi) 읽기
    const t0 = Date.now()
    const wins = listWindows()
    const presses = createPressReader()
    console.log(`[selftest] windows=${wins.length} ms=${Date.now() - t0} presses=${presses ? JSON.stringify(presses()) : 'none'} resources=${process.resourcesPath}`)
    app.exit(0)
    return
  }
  store = new Store()
  wasPaused = paused()
  overlays = new Overlays(() => ({ paused: paused(), locked, settings: store.state.settings }), onReport)
  registerIpc()
  overlays.sync()
  if (!headless || env.PIGEON_PANEL_SHOT || (env.PIGEON_SCRIPT && /"panel(Js|Shot)"/.test(readFileSync(env.PIGEON_SCRIPT, 'utf8')))) createPanel()
  if (!headless) createTray()
  if (process.platform === 'darwin' && startHidden) app.dock?.hide()

  store.onChange((s) => {
    panel?.webContents.send('state:changed', s)
    overlays.pushConfig()
    buildTrayMenu()
    const p = paused()
    if (p && !wasPaused) {
      // 쉬기 시작: 있던 비둘기도 돌려보낸다
      shooAll()
      overlays.poll()
    }
    wasPaused = p
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.settings.openAtLogin, args: ['--hidden'] })
    tickPresence()
  })
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: store.state.settings.openAtLogin, args: ['--hidden'] })

  // 잠금 중에는 오버레이를 숨겨 비둘기를 멈춰 둔다 → 돌아오면 그대로 있다
  powerMonitor.on('lock-screen', () => {
    locked = true
    setFeeding(false)
    overlays.refreshAll()
    tickPresence()
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    overlays.refreshAll()
    tickPresence()
  })
  setInterval(tickPresence, 1000)
  tickPresence()

  if (env.PIGEON_PANEL_SHOT && panel) {
    const p = panel
    p.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const img = await p.webContents.capturePage()
        writeFileSync(env.PIGEON_PANEL_SHOT!, img.toPNG())
        quitting = true
        app.quit()
      }, Number(env.PIGEON_SHOT_DELAY ?? 1500))
    )
  }
  runScript()
  setupUpdater()
  app.on('activate', showPanel)
})

app.on('before-quit', () => {
  quitting = true
  store?.flush()
  overlays?.destroy()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// 창을 모두 닫아도 트레이에 상주
app.on('window-all-closed', () => {
  if (headless || labMode) app.quit()
})
