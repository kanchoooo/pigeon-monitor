// 투명 전체화면 오버레이 (디스플레이마다 하나) — 비둘기 세상을 돌린다
import './overlay.css'
import type { Perch } from '@shared/types'
import { World } from './world'

const api = window.overlayApi
const stage = document.getElementById('stage')!
const debug = new URLSearchParams(location.search).has('debug')
const world = new World(stage, (r) => api.report(r))
// 자동 테스트에서 비둘기 위치를 찾을 수 있게
if (debug) (window as unknown as { __world: World }).__world = world

// ── 모이 주기 안내 + 커서에 붙는 모이 봉투
const hud = document.createElement('div')
hud.className = 'hud'
hud.style.top = api.platform === 'darwin' ? '38px' : '14px'
hud.innerHTML = '<span>🌾 모이 주는 중 — 아무 데나 클릭하면 모이가 떨어져요</span><button type="button">그만 주기 (ESC)</button>'
const hudBtn = hud.querySelector('button')!
hudBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  api.report({ type: 'feedEnd' })
})
hud.addEventListener('pointerdown', (e) => e.stopPropagation())
document.body.appendChild(hud)

const bag = document.createElement('canvas')
bag.className = 'bag'
drawBag(bag)
document.body.appendChild(bag)

function drawBag(cv: HTMLCanvasElement): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1)
  cv.width = 34 * dpr
  cv.height = 34 * dpr
  cv.style.width = '34px'
  cv.style.height = '34px'
  const c = cv.getContext('2d')!
  c.scale(dpr, dpr)
  c.lineJoin = 'round'
  c.lineWidth = 2
  c.strokeStyle = '#4a3420'
  c.fillStyle = '#d9b27c'
  c.beginPath()
  c.moveTo(9, 10)
  c.quadraticCurveTo(3, 22, 7, 30)
  c.quadraticCurveTo(17, 34, 27, 30)
  c.quadraticCurveTo(31, 22, 25, 10)
  c.closePath()
  c.fill()
  c.stroke()
  c.fillStyle = '#c49a62'
  c.beginPath()
  c.ellipse(17, 10, 9, 3.5, 0, 0, Math.PI * 2)
  c.fill()
  c.stroke()
  for (const [x, y, col] of [
    [13, 8, '#f4c430'],
    [18, 7, '#4a3f36'],
    [21, 9, '#f4c430'],
    [16, 10, '#d8a464']
  ] as [number, number, string][]) {
    c.fillStyle = col
    c.beginPath()
    c.arc(x, y, 1.6, 0, Math.PI * 2)
    c.fill()
  }
  c.fillStyle = '#4a3420'
  c.font = 'bold 9px sans-serif'
  c.textAlign = 'center'
  c.fillText('모이', 17, 24)
}

// ── 디버그 배경 (자동 테스트용): 가짜 창을 그린다
let debugCv: HTMLCanvasElement | null = null
function drawDebug(perches: Perch[]): void {
  if (!debug) return
  if (!debugCv) {
    debugCv = document.createElement('canvas')
    debugCv.id = 'debug-bg'
    document.body.insertBefore(debugCv, stage)
  }
  const cv = debugCv
  cv.width = world.w
  cv.height = world.h
  const c = cv.getContext('2d')!
  const g = c.createLinearGradient(0, 0, 0, world.h)
  g.addColorStop(0, '#5b8fd6')
  g.addColorStop(1, '#a9c9ef')
  c.fillStyle = g
  c.fillRect(0, 0, world.w, world.h)
  const wins = new Map<number, Perch[]>()
  for (const p of perches) if (p.wid) wins.set(p.wid, [...(wins.get(p.wid) ?? []), p])
  // perches 는 앞 창부터 오므로 뒤 창부터 그린다
  for (const [, ps] of [...wins].reverse()) {
    const x0 = Math.min(...ps.map((p) => p.x0)) - 16
    const x1 = Math.max(...ps.map((p) => p.x1)) + 16
    const y = ps[0].y
    c.fillStyle = '#f6f7f9'
    c.fillRect(x0, y, x1 - x0, 260)
    c.fillStyle = '#e3e6eb'
    c.fillRect(x0, y, x1 - x0, 28)
    c.strokeStyle = '#9aa0ab'
    c.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, 259)
  }
  const floor = perches.find((p) => p.wid === 0)
  if (floor) {
    c.fillStyle = 'rgba(30,30,40,0.55)'
    c.fillRect(0, floor.y, world.w, world.h - floor.y)
  }
}

// ── 클릭 통과 전환: 비둘기 위·쫓는 비둘기 근처에 있을 때(또는 모이 주는 중)만 클릭을 받는다
let interactive = false
function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  api.setInteractive(on)
}

// 클릭은 두 길로 온다: 렌더러 pointerdown(맥) · 메인이 읽은 버튼 누름(윈도우, 맥은 보험).
// 같은 클릭이 두 번 들어오면 하나만 쓴다.
let lastPress = { src: '', t: -1e9, x: 0, y: 0, button: -1 }
function press(src: 'dom' | 'main', x: number, y: number, button: number): void {
  const t = performance.now()
  const l = lastPress
  if (src !== l.src && button === l.button && t - l.t < 160 && Math.hypot(x - l.x, y - l.y) < 48) return
  lastPress = { src, t, x, y, button }
  world.setCursor(x, y)
  if (button === 0) {
    if (inside(hud, x, y)) {
      // 버튼 위 클릭이 메인에서 왔으면 (윈도우) 여기서 눌러 준다
      if (src === 'main' && inside(hudBtn, x, y)) api.report({ type: 'feedEnd' })
      return
    }
    world.pointerDown(x, y)
  } else if (button === 2 && world.feeding) api.report({ type: 'feedEnd' })
  kick()
}

function inside(e: HTMLElement, x: number, y: number): boolean {
  if (e.offsetParent === null && getComputedStyle(e).display === 'none') return false
  const r = e.getBoundingClientRect()
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

window.addEventListener('pointerdown', (e) => press('dom', e.clientX, e.clientY, e.button))
api.onPress(({ x, y, button }) => press('main', x, y, button))
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('pointermove', (e) => {
  if (interactive) world.setCursor(e.clientX, e.clientY)
})

// ── 루프: 보일 게 있으면 매 프레임, 기다리는 중이면 0.25초마다, 아니면 쉰다
let raf = 0
let timer: ReturnType<typeof setTimeout> | null = null
let last = performance.now()

function frame(): void {
  // 창이 숨겨져 있던 시간(화면 잠금 등)은 세상 시간에 넣지 않는다
  const maxDt = raf ? 0.05 : 0.3
  raf = 0
  timer = null
  const now = performance.now()
  if (debug && maxDt < 0.1 && now - last > 150) console.log(`[gap] ${Math.round(now - last)}ms now=${world.now.toFixed(2)}`)
  const dt = Math.min(maxDt, Math.max(0.001, (now - last) / 1000))
  last = now
  world.update(dt)
  setInteractive(world.wantsMouse())
  const chasing = world.chasing
  if (chasing !== document.body.classList.contains('chasing')) document.body.classList.toggle('chasing', chasing)
  if (world.feeding) bag.style.transform = `translate3d(${world.cursor.x + 10}px, ${world.cursor.y + 8}px, 0)`
  schedule()
}

function schedule(): void {
  if (raf || timer) return
  if (world.visual) raf = requestAnimationFrame(frame)
  else if (world.waiting) timer = setTimeout(frame, 250)
  else {
    setInteractive(false)
    world.sendStatus()
  }
}

function kick(): void {
  if (!raf && !timer) last = performance.now()
  schedule()
}

api.onInit(({ width, height }) => {
  world.w = width
  world.h = height
  kick()
})
api.onPerches((v) => {
  world.setPerches(v.perches, v.blocked)
  drawDebug(v.perches)
  kick()
})
api.onCursor(({ x, y }) => {
  world.setCursor(x, y)
})
api.onPresence((v) => {
  world.setPresence(v.away)
  kick()
})
api.onConfig((c) => {
  world.setConfig(c)
  kick()
})
api.onFeed((on) => {
  // 메인이 이미 클릭 통과로 되돌렸다 → 필요하면 다음 프레임에 다시 켠다
  if (!on) interactive = false
  world.setFeeding(on)
  document.body.classList.toggle('feeding', on)
  kick()
})
api.onCommand((cmd) => {
  if (cmd.type === 'summon') world.summon(cmd.count)
  else if (cmd.type === 'shooAll') world.shooAll()
  else if (cmd.type === 'release') world.release(cmd.breed)
  else if (cmd.type === 'caughtInfo') world.caughtInfo(cmd.breed, cmd.isNew, cmd.count)
  kick()
})

void document.fonts.load("12px 'Galmuri11'").catch(() => undefined)
api.ready()
