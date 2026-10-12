// 생포 리플레이 감독: 기록된 위치·자세로 추격 장면을 다시 그린다.
// 카메라가 비둘기를 따라가다 마지막 한 방에서 슬로모션·클로즈업, 그리고 '생포!' 도장.
// 패널 재생 · 네컷 사진 · 영상 저장이 모두 이 그림을 쓴다. (내 화면은 담지 않고 창 모양만 다시 그린다)
import { BREED, RARITY, type Breed } from '@shared/breeds'
import { FI, FROM_LABEL, POSE_KEYS, type AlbumEntry, type ChaseFrom, type Replay } from '@shared/replay'
import { drawPigeon, makePose, type Pose } from '../pigeon/draw'
import { Sfx } from '../pigeon/sound'

const PIX = "'Galmuri11', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const ease = (k: number): number => k * k * (3 - 2 * k)
const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3)

/** 같은 장면은 늘 같은 깃털이 날리도록 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind = 'intro' | 'chase' | 'slow' | 'impact'

interface Seg {
  kind: Kind
  /** 재생 시각 (초) */
  start: number
  dur: number
  /** 기록 시각 구간 */
  t0: number
  t1: number
  /** 보이는 폭 (화면 px) */
  v0: number
  v1: number
}

/** 한 장면: 기록 시각 t, 보이는 폭, 잡힌 뒤 지난 시간 ti(-1 = 아직) */
export interface Shot {
  t: number
  view: number
  kind: Kind
  k: number
  ti: number
}

interface Feather {
  t0: number
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  ph: number
}

interface Sample {
  x: number
  y: number
  cx: number
  cy: number
  pose: Pose
}

/** 잡힌 뒤 도장·이름표까지 보여 주는 시간 */
const IMPACT = 3.0
const HIT_WORDS = ['톡!', '탁!', '콕!', '앗!', '퍽!']

const BEFORE_CAPTION: Record<ChaseFrom, string> = {
  eat: '냠냠 먹는 중…',
  rest: '꾸벅꾸벅 조는 중…',
  tame: '자유를 만끽하는 중…',
  normal: '한가롭게 노는 중…'
}

export interface RenderOpts {
  /** REPLAY 표시 · 자막 */
  hud?: boolean
  /** 잡힌 뒤 이름표 */
  banner?: boolean
  /** 아래쪽 자막을 직접 정한다 */
  caption?: string
  /** 워터마크 (기본 켬) */
  mark?: boolean
  /** 목록 썸네일: 효과를 줄이고 비둘기만 크게 */
  thumb?: boolean
}

export class ReplayDirector {
  readonly breed: Breed
  /** 비둘기 그림 배율 (설정 크기 × 품종 크기) */
  readonly k: number
  readonly total: number
  readonly tStart: number
  readonly tLast: number
  private segs: Seg[] = []
  private feathers: Feather[] = []
  private words: string[] = []

  constructor(
    readonly r: Replay,
    private entry: Pick<AlbumEntry, 'isNew'> = { isNew: false }
  ) {
    this.breed = BREED[r.breed]
    this.k = r.size * this.breed.look.scale
    const f = r.frames
    this.tStart = f[0][FI.t]
    this.tLast = clamp(r.caughtAt, this.tStart, f[f.length - 1][FI.t])
    const tChase = clamp(r.chaseAt, this.tStart, this.tLast)
    const tSlow = Math.max(tChase, this.tLast - 0.45)
    let at = 0
    let v = 330
    const add = (kind: Kind, t0: number, t1: number, dur: number, v1: number): void => {
      if (dur <= 0.001) return
      this.segs.push({ kind, start: at, dur, t0, t1, v0: v, v1 })
      at += dur
      v = v1
    }
    add('intro', this.tStart, tChase, tChase - this.tStart, 360)
    // 추격이 길면 빨리 감기 (최대 5초)
    add('chase', tChase, tSlow, Math.min(tSlow - tChase, 5), 560)
    add('slow', tSlow, this.tLast, (this.tLast - tSlow) / 0.25, 210)
    add('impact', this.tLast, this.tLast, IMPACT, 250)
    this.total = at

    // 맞을 때마다 깃털 몇 개, 잡힐 때 한 움큼
    const rand = rng(r.frames.length * 7919 + r.hits.length)
    const puff = (t0: number, n: number, power: number): void => {
      const s = this.sample(t0)
      const c = this.center(s)
      for (let i = 0; i < n; i++) {
        this.feathers.push({
          t0,
          x: c.x + (rand() - 0.5) * 16,
          y: c.y + (rand() - 0.5) * 12,
          vx: (rand() - 0.5) * 140 * power,
          vy: (-30 - rand() * 120) * power,
          rot: rand() * TAU,
          vr: (rand() - 0.5) * 9,
          ph: rand() * TAU
        })
      }
    }
    r.hits.forEach((h, i) => {
      puff(h.t, 3, 1)
      this.words.push(i === 0 ? '꾸룩?!' : HIT_WORDS[Math.floor(rand() * HIT_WORDS.length)])
    })
    puff(this.tLast + 0.02, 14, 1.5)
  }

  // ───────── 시간표 ─────────

  shot(tau: number): Shot {
    const s = this.segs.find((x) => tau < x.start + x.dur) ?? this.segs[this.segs.length - 1]
    const k = clamp((tau - s.start) / s.dur, 0, 1)
    const e = s.kind === 'chase' ? easeOut(Math.min(1, k * 3)) : ease(k)
    return { t: lerp(s.t0, s.t1, k), view: lerp(s.v0, s.v1, e), kind: s.kind, k, ti: s.kind === 'impact' ? tau - s.start : -1 }
  }

  /** 네컷용 정지 장면 */
  still(kind: 'before' | 'chase' | 'hit' | 'caught'): Shot {
    const r = this.r
    if (kind === 'before') return { t: clamp(r.chaseAt - 0.3, this.tStart, this.tLast), view: 300, kind: 'intro', k: 1, ti: -1 }
    if (kind === 'chase') {
      // 날고 있고, 커서가 바짝 쫓아오는 순간을 고른다
      const h0 = r.hits[0]?.t ?? r.chaseAt
      let best = clamp(h0 + Math.min(0.55, (this.tLast - h0) / 2), this.tStart, this.tLast)
      let score = -Infinity
      for (const f of r.frames) {
        const t = f[FI.t]
        if (t < h0 + 0.12 || t > this.tLast - 0.15) continue
        const s = this.sample(t)
        const c = this.center(s)
        const d = Math.hypot(s.cx - c.x, s.cy - c.y)
        const sc = -Math.abs(d - 80) + s.pose.fly * 40 - (c.y < 70 ? 60 : 0)
        if (sc > score) {
          score = sc
          best = t
        }
      }
      return { t: best, view: 380, kind: 'chase', k: 1, ti: -1 }
    }
    if (kind === 'hit') return { t: Math.max(this.tStart, this.tLast - 0.05), view: 200, kind: 'slow', k: 1, ti: -1 }
    return { t: this.tLast, view: 250, kind: 'impact', k: 1, ti: IMPACT }
  }

  // ───────── 기록 읽기 ─────────

  sample(t: number): Sample {
    const f = this.r.frames
    let lo = 0
    let hi = f.length - 1
    if (t <= f[0][FI.t]) hi = 0
    else if (t >= f[hi][FI.t]) lo = hi
    else {
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1
        if (f[m][FI.t] <= t) lo = m
        else hi = m
      }
    }
    const a = f[lo]
    const b = f[hi]
    const u = hi === lo ? 0 : clamp((t - a[FI.t]) / (b[FI.t] - a[FI.t] || 1), 0, 1)
    const v = (i: number): number => lerp(a[i], b[i], u)
    const pose = makePose()
    const pr = pose as unknown as Record<string, number>
    POSE_KEYS.forEach((key, j) => {
      const i = FI.pose + j
      pr[key] = key === 'dir' ? (u < 0.5 ? a[i] : b[i]) : v(i)
    })
    pose.dir = pose.dir < 0 ? -1 : 1
    pose.t = t
    return { x: v(FI.x), y: v(FI.y), cx: v(FI.cx), cy: v(FI.cy), pose }
  }

  private center(s: Sample): { x: number; y: number } {
    return { x: s.x + s.pose.dir * 2 * this.k, y: s.y - 20 * this.k }
  }

  /** 카메라: 비둘기를 부드럽게 따라가되 화면 밖은 보이지 않게 */
  private cam(t: number, vw: number, vh: number): { x: number; y: number } {
    let sx = 0
    let sy = 0
    const spread = 0.3 * clamp(vw / 560, 0.3, 1)
    const ds = [-spread, -spread / 2, 0, spread / 2, spread]
    for (const d of ds) {
      const c = this.center(this.sample(clamp(t + d, this.tStart, this.tLast)))
      sx += c.x
      sy += c.y
    }
    // 비둘기가 가운데 오도록 (화면 끝에서는 바깥 하늘이 조금 보여도 된다)
    const r = this.r
    return { x: clamp(sx / ds.length, vw * 0.3, r.w - vw * 0.3), y: clamp(sy / ds.length, vh * 0.3, r.h - vh * 0.3) }
  }

  // ───────── 그리기 ─────────

  render(c: CanvasRenderingContext2D, W: number, H: number, sh: Shot, o: RenderOpts = {}): void {
    const r = this.r
    const rar = RARITY[this.breed.rarity]
    const vw = sh.view
    const vh = (sh.view * H) / W
    const sc = W / vw
    const imp = sh.kind === 'impact'
    const ti = sh.ti
    // 도장이 쾅 찍힐 때 화면이 흔들린다
    const shake = imp && ti > 0.48 && ti < 0.66 ? Math.sin(ti * 95) * W * 0.012 * (1 - (ti - 0.48) / 0.18) : 0
    const cam = this.cam(sh.t, vw, vh)
    const toScreen = (x: number, y: number): [number, number] => [(x - cam.x) * sc + W / 2 + shake, (y - cam.y) * sc + H / 2]

    c.save()
    // 하늘 (바탕화면)
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#5b8fd6')
    g.addColorStop(1, '#a9c9ef')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)

    c.save()
    c.translate(W / 2 + shake, H / 2)
    c.scale(sc, sc)
    c.translate(-cam.x, -cam.y)
    this.drawDesk(c)

    const s = this.sample(sh.t)
    const ctr = this.center(s)
    if (imp) this.drawRays(c, ctr.x, ctr.y, ti, rar.color)

    // 비둘기
    const pose = s.pose
    let px = s.x
    if (imp) {
      // 잡혀서 버둥버둥
      pose.fly = 0.55
      pose.spread = 1
      pose.flap = Math.sin(ti * 40)
      pose.look = -0.6
      pose.tilt = Math.sin(ti * 21) * 0.14
      pose.t = sh.t + ti
      px += Math.sin(ti * 57) * 1.6
    }
    c.save()
    c.translate(px, s.y)
    c.scale(r.size, r.size)
    drawPigeon(c, this.breed.look, pose, { shadow: pose.fly < 0.4 })
    c.restore()

    // 깃털 (잡힌 뒤에도 계속 날린다)
    const tf = imp ? this.tLast + ti : sh.t
    for (const f of this.feathers) {
      const a = tf - f.t0
      if (a < 0 || a > 1.8) continue
      const x = f.x + f.vx * a * (1 - a * 0.25) + Math.sin(a * 5 + f.ph) * 9
      const y = f.y + f.vy * a + 70 * a * a
      c.save()
      c.globalAlpha = clamp(1 - a / 1.8, 0, 1)
      c.translate(x, y)
      c.rotate(f.rot + f.vr * a)
      c.fillStyle = this.breed.look.wing
      c.strokeStyle = 'rgba(0,0,0,0.3)'
      c.lineWidth = 0.6
      c.beginPath()
      c.ellipse(0, 0, 5.5, 2.2, 0, 0, TAU)
      c.fill()
      c.stroke()
      c.restore()
    }
    c.restore()

    // ── 여기부터 화면 좌표
    const [sx, sy] = toScreen(ctr.x, ctr.y)
    const hitsSoFar = r.hits.filter((h) => h.t <= sh.t + 1e-6).length

    // 맞힌 횟수 (게임 화면과 같은 동그라미)
    if (!imp && !o.thumb && sh.t >= r.chaseAt - 1e-6) this.drawPips(c, sx, sy - 34 * this.k * sc, hitsSoFar, r.need, W)

    // 클릭 물결 · '톡!'
    for (let i = 0; i < r.hits.length; i++) {
      const h = r.hits[i]
      const a = sh.t - h.t
      if (a < 0 || a > 0.55 || (imp && i < r.hits.length - 1)) continue
      const [hx, hy] = toScreen(h.x, h.y)
      this.ripple(c, hx, hy, imp ? Math.min(0.5, ti) / 0.5 : a / 0.4, W, '#ffe066')
      if (!imp && !o.thumb) outlined(c, this.words[i], hx + W * 0.04, hy - W * 0.05 - a * W * 0.06, W * 0.05, '#ffe066')
    }
    for (const m of r.misses) {
      const a = sh.t - m.t
      if (a < 0 || a > 0.4 || imp) continue
      const [mx, my] = toScreen(m.x, m.y)
      this.ripple(c, mx, my, a / 0.4, W, 'rgba(255,255,255,0.85)')
    }

    // 커서
    const last = r.hits[r.hits.length - 1]
    const [cx, cy] = imp && last ? toScreen(last.x, last.y) : toScreen(s.cx, s.cy)
    const pressed = r.hits.some((h) => sh.t - h.t >= 0 && sh.t - h.t < 0.09) || (imp && ti < 0.12)
    if (cx > -W * 0.1 && cx < W * 1.1 && cy > -H * 0.1 && cy < H * 1.1 && s.cx > -9000) drawCursor(c, cx, cy, W * 0.055 * (pressed ? 0.86 : 1))

    // 슬로모션 집중선
    if (sh.kind === 'slow' && !o.thumb) this.speedLines(c, W, H, sx, sy, ease(sh.k), Math.floor(sh.t * 40))

    if (imp) this.drawImpact(c, W, H, sx, sy, ti, o)

    // 화면 위 표시
    if (o.hud) {
      if (!imp || ti < 0.25) {
        const blink = Math.floor(sh.t * 2.5) % 2 === 0
        c.fillStyle = blink ? '#ff3b3b' : 'rgba(255,59,59,0.35)'
        c.beginPath()
        c.arc(W * 0.06, H * 0.065, W * 0.016, 0, TAU)
        c.fill()
        outlined(c, sh.kind === 'slow' ? 'REPLAY · SLOW' : 'REPLAY', W * 0.088, H * 0.066, W * 0.036, '#ffffff', '#1f2330', 'left')
      }
    }
    const cap = o.caption ?? (o.hud ? (sh.kind === 'intro' ? `${FROM_LABEL[r.from]}…` : sh.kind === 'chase' ? '도망쳐 구구!!' : sh.kind === 'slow' ? '잡았…?!' : '') : '')
    if (cap && !imp) this.caption(c, W, H, cap)
    // 워터마크
    if (o.mark !== false && !o.thumb) {
      c.globalAlpha = 0.85
      outlined(c, '🕊 비둘기 모니터', W * 0.965, H * 0.955, W * 0.026, '#ffffff', 'rgba(31,35,48,0.85)', 'right')
      c.globalAlpha = 1
    }
    c.restore()
  }

  /** 창 모양 (가짜 바탕화면) — 앞 창부터 기록돼 있어 뒤 창부터 그린다 */
  private drawDesk(c: CanvasRenderingContext2D): void {
    const r = this.r
    const wins = new Map<number, { x0: number; x1: number; y: number }>()
    const order: number[] = []
    for (const p of r.perches) {
      if (!p.wid) continue
      const w = wins.get(p.wid)
      if (!w) {
        wins.set(p.wid, { x0: p.x0, x1: p.x1, y: p.y })
        order.push(p.wid)
      } else {
        w.x0 = Math.min(w.x0, p.x0)
        w.x1 = Math.max(w.x1, p.x1)
      }
    }
    for (const id of order.reverse()) {
      const w = wins.get(id)!
      const x0 = w.x0 - 16
      const ww = w.x1 - w.x0 + 32
      const hh = Math.max(60, Math.min(r.floorY, w.y + 440) - w.y)
      c.fillStyle = 'rgba(20, 30, 60, 0.14)'
      roundRect(c, x0 + 5, w.y + 7, ww, hh, 10)
      c.fill()
      c.fillStyle = '#fbfcfe'
      roundRect(c, x0, w.y, ww, hh, 9)
      c.fill()
      c.save()
      roundRect(c, x0, w.y, ww, hh, 9)
      c.clip()
      c.fillStyle = '#e6eaf1'
      c.fillRect(x0, w.y, ww, 26)
      // 내용 대신 회색 줄 몇 개
      c.fillStyle = '#eef1f6'
      for (let i = 0; i < 6; i++) {
        const ly = w.y + 46 + i * 24
        if (ly > w.y + hh - 14) break
        c.fillRect(x0 + 18, ly, (ww - 36) * (i % 3 === 2 ? 0.55 : i % 2 ? 0.8 : 0.92), 9)
      }
      c.restore()
      ;['#ff6159', '#ffbd2e', '#28c941'].forEach((col, i) => {
        c.fillStyle = col
        c.beginPath()
        c.arc(x0 + 15 + i * 14, w.y + 13, 4.2, 0, TAU)
        c.fill()
      })
      c.strokeStyle = '#c3cad6'
      c.lineWidth = 1.4
      roundRect(c, x0, w.y, ww, hh, 9)
      c.stroke()
    }
    // 바닥 (작업 표시줄·Dock)
    c.fillStyle = 'rgba(30, 34, 48, 0.55)'
    c.fillRect(-3000, r.floorY, r.w + 6000, r.h - r.floorY + 3000)
  }

  private drawRays(c: CanvasRenderingContext2D, x: number, y: number, ti: number, color: string): void {
    const n = 14
    const R = 420
    c.save()
    c.translate(x, y)
    c.rotate(ti * 0.6)
    c.globalAlpha = 0.32 * clamp(ti / 0.25, 0, 1)
    c.fillStyle = color
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU
      c.beginPath()
      c.moveTo(0, 0)
      c.arc(0, 0, R, a, a + (TAU / n) * 0.45)
      c.closePath()
      c.fill()
    }
    c.restore()
  }

  private drawPips(c: CanvasRenderingContext2D, x: number, y: number, hits: number, need: number, W: number): void {
    const d = W * 0.022
    const gap = d * 0.35
    const w = need * d + (need - 1) * gap + d * 0.9
    c.fillStyle = 'rgba(31, 35, 48, 0.82)'
    roundRect(c, x - w / 2, y - d * 0.95, w, d * 1.9, d)
    c.fill()
    for (let i = 0; i < need; i++) {
      const px = x - w / 2 + d * 0.45 + d / 2 + i * (d + gap)
      c.beginPath()
      c.arc(px, y, d / 2, 0, TAU)
      c.fillStyle = i < hits ? '#ff7a2f' : 'rgba(255,255,255,0.3)'
      c.fill()
    }
  }

  private ripple(c: CanvasRenderingContext2D, x: number, y: number, k: number, W: number, color: string): void {
    const kk = clamp(k, 0, 1)
    c.save()
    c.globalAlpha = 1 - kk
    c.strokeStyle = color
    c.lineWidth = W * 0.008
    c.beginPath()
    c.arc(x, y, W * (0.012 + 0.05 * easeOut(kk)), 0, TAU)
    c.stroke()
    c.restore()
  }

  private speedLines(c: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, k: number, seed: number): void {
    const rand = rng(seed)
    c.save()
    c.globalAlpha = 0.5 * k
    c.strokeStyle = '#1f2330'
    for (let i = 0; i < 34; i++) {
      const a = rand() * TAU
      const r0 = W * (0.36 + rand() * 0.12)
      const r1 = W * 0.95
      c.lineWidth = W * (0.002 + rand() * 0.005)
      c.beginPath()
      c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
      c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
      c.stroke()
    }
    c.restore()
  }

  private caption(c: CanvasRenderingContext2D, W: number, H: number, text: string): void {
    const size = W * 0.046
    c.font = `bold ${size}px ${PIX}`
    const tw = c.measureText(text).width
    const pw = tw + size * 1.4
    const ph = size * 1.7
    c.fillStyle = 'rgba(31, 35, 48, 0.78)'
    roundRect(c, (W - pw) / 2, H * 0.87 - ph / 2, pw, ph, ph / 2)
    c.fill()
    c.fillStyle = '#ffffff'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, W / 2, H * 0.87 + size * 0.05)
  }

  /** 잡힌 순간: 번쩍 → '생포!' 도장 → 이름표 → NEW */
  private drawImpact(c: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, ti: number, o: RenderOpts): void {
    const r = this.r
    const b = this.breed
    const rar = RARITY[b.rarity]
    // 도장
    if (ti > 0.3) {
      const k = clamp((ti - 0.3) / 0.2, 0, 1)
      const s = lerp(2.8, 1, easeOut(k))
      c.save()
      c.translate(W / 2, Math.min(H * 0.22, y - W * 0.22))
      c.rotate(-0.2)
      c.scale(s, s)
      c.globalAlpha = clamp(k * 2.2, 0, 1)
      const size = W * 0.13
      c.font = `bold ${size}px ${PIX}`
      const tw = c.measureText('생포!').width
      const bw = tw + size * 0.7
      const bh = size * 1.45
      c.fillStyle = 'rgba(255, 255, 255, 0.82)'
      roundRect(c, -bw / 2, -bh / 2, bw, bh, size * 0.2)
      c.fill()
      c.strokeStyle = '#e03131'
      c.lineWidth = size * 0.09
      roundRect(c, -bw / 2, -bh / 2, bw, bh, size * 0.2)
      c.stroke()
      c.lineWidth = size * 0.035
      roundRect(c, -bw / 2 + size * 0.12, -bh / 2 + size * 0.12, bw - size * 0.24, bh - size * 0.24, size * 0.12)
      c.stroke()
      c.fillStyle = '#e03131'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText('생포!', 0, size * 0.06)
      c.restore()
    }
    // 이름표
    if (o.banner !== false && ti > 0.6) {
      const k = easeOut(clamp((ti - 0.6) / 0.28, 0, 1))
      const bw = W * 0.86
      const bh = H * 0.19
      const bx = (W - bw) / 2
      const by = lerp(H + 10, H * 0.77, k)
      c.fillStyle = '#ffffff'
      c.strokeStyle = '#1f2330'
      c.lineWidth = W * 0.007
      roundRect(c, bx, by, bw, bh, W * 0.035)
      c.fill()
      c.stroke()
      const tag = rar.label
      const ts = W * 0.03
      c.font = `bold ${ts}px ${PIX}`
      const tagW = c.measureText(tag).width + ts * 1.2
      c.fillStyle = rar.color
      roundRect(c, bx + W * 0.04, by + bh * 0.2, tagW, ts * 1.7, ts * 0.5)
      c.fill()
      c.fillStyle = '#ffffff'
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      c.fillText(tag, bx + W * 0.04 + ts * 0.6, by + bh * 0.2 + ts * 0.9)
      c.fillStyle = '#1f2330'
      c.font = `bold ${W * 0.058}px ${PIX}`
      c.fillText(b.name, bx + W * 0.06 + tagW, by + bh * 0.2 + ts * 0.9)
      c.font = `${W * 0.036}px ${PIX}`
      c.fillStyle = '#4a4d57'
      c.fillText(statLine(r), bx + W * 0.04, by + bh * 0.68)
    }
    // NEW
    if (this.entry.isNew && ti > 0.95) {
      const k = clamp((ti - 0.95) / 0.18, 0, 1)
      c.save()
      c.translate(W * 0.83, o.banner === false ? H * 0.8 : H * 0.76)
      c.rotate(0.18)
      c.scale(lerp(1.8, 1, easeOut(k)), lerp(1.8, 1, easeOut(k)))
      starburst(c, W * 0.085, '#ffd43b', '#1f2330', W)
      outlined(c, 'NEW!', 0, -W * 0.008, W * 0.042, '#e03131', '#ffffff')
      outlined(c, '도감 등록', 0, W * 0.035, W * 0.022, '#1f2330', '#ffffff')
      c.restore()
    }
    // 번쩍
    if (ti < 0.32) {
      c.fillStyle = `rgba(255,255,255,${(0.9 * (1 - ti / 0.32)).toFixed(3)})`
      c.fillRect(0, 0, W, H)
    }
    void x
  }

  // ───────── 소리 ─────────

  /** 재생 시각 a → b 사이에 난 소리 */
  sounds(a: number, b: number, sfx: Sfx): void {
    if (b <= a) return
    const sa = this.shot(a)
    const sb = this.shot(b)
    const ta = a <= 0 ? -Infinity : sa.t
    this.r.hits.forEach((h, i) => {
      if (h.t > ta && h.t <= sb.t) {
        if (i === 0) sfx.squawk(0)
        else {
          sfx.peck(0)
          sfx.flap(0, 3, 0.7)
        }
      }
    })
    const imp = this.segs[this.segs.length - 1]
    const ia = a - imp.start
    const ib = b - imp.start
    if (ia < 0.05 && ib >= 0.05) sfx.caught(0, this.breed.rarity !== 'common' && this.breed.rarity !== 'uncommon')
    if (ia < 0.5 && ib >= 0.5) sfx.drop(0)
  }
}

// ───────── 그림 도구 ─────────

export function statLine(r: Replay): string {
  const secs = Math.max(0, r.caughtAt - r.chaseAt)
  return `${r.need}번 만에 · ${secs.toFixed(1)}초 · ${FROM_LABEL[r.from]} 딱 걸림`
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

function outlined(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = '#ffffff', stroke = '#1f2330', align: CanvasTextAlign = 'center'): void {
  c.font = `bold ${size}px ${PIX}`
  c.textAlign = align
  c.textBaseline = 'middle'
  c.lineJoin = 'round'
  c.lineWidth = size * 0.24
  c.strokeStyle = stroke
  c.strokeText(text, x, y)
  c.fillStyle = fill
  c.fillText(text, x, y)
}

function drawCursor(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const pts: [number, number][] = [
    [0, 0],
    [0, 0.74],
    [0.19, 0.58],
    [0.32, 0.88],
    [0.45, 0.82],
    [0.32, 0.53],
    [0.56, 0.53]
  ]
  c.save()
  c.translate(x, y)
  c.beginPath()
  pts.forEach(([px, py], i) => (i ? c.lineTo(px * s, py * s) : c.moveTo(px * s, py * s)))
  c.closePath()
  c.fillStyle = '#ffffff'
  c.strokeStyle = '#1f2330'
  c.lineJoin = 'round'
  c.lineWidth = s * 0.08
  c.fill()
  c.stroke()
  c.restore()
}

function starburst(c: CanvasRenderingContext2D, R: number, fill: string, stroke: string, W: number): void {
  const n = 12
  c.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2
    const rr = i % 2 ? R * 0.74 : R
    const x = Math.cos(a) * rr
    const y = Math.sin(a) * rr
    if (i) c.lineTo(x, y)
    else c.moveTo(x, y)
  }
  c.closePath()
  c.fillStyle = fill
  c.strokeStyle = stroke
  c.lineWidth = W * 0.005
  c.fill()
  c.stroke()
}

// ───────── 네컷 사진 ─────────

/** 비둘기 네컷 (1080×1350, 인스타 세로): ① 평화 ② 추격 ③ 클로즈업 ④ 생포 */
export async function makeFourCut(r: Replay, e: Pick<AlbumEntry, 'isNew'>): Promise<string> {
  await document.fonts.load(`bold 40px 'Galmuri11'`).catch(() => undefined)
  const W = 1080
  const H = 1350
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')!
  const d = new ReplayDirector(r, e)
  const b = d.breed
  const rar = RARITY[b.rarity]

  c.fillStyle = '#1d2130'
  c.fillRect(0, 0, W, H)
  // 필름 구멍
  c.fillStyle = '#2c3245'
  for (let y = 26; y < H; y += 54) {
    roundRect(c, 12, y, 16, 26, 5)
    c.fill()
    roundRect(c, W - 28, y, 16, 26, 5)
    c.fill()
  }
  c.textAlign = 'center'
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#ffffff'
  c.font = `bold 70px ${PIX}`
  c.fillText('비둘기 네컷', W / 2, 108)
  c.font = `26px ${PIX}`
  c.fillStyle = '#aab3c8'
  const when = new Date(r.at)
  c.fillText(`${when.getFullYear()}.${String(when.getMonth() + 1).padStart(2, '0')}.${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')} · 내 모니터에서 생긴 일`, W / 2, 150)

  const cuts: { shot: Shot; cap: string; banner?: boolean }[] = [
    { shot: d.still('before'), cap: BEFORE_CAPTION[r.from] },
    { shot: d.still('chase'), cap: '도망쳐 구구!!' },
    { shot: d.still('hit'), cap: '지금이다!!' },
    { shot: d.still('caught'), cap: '생포 성공 ✨', banner: false }
  ]
  const pw = 480
  const ph = 468
  const gx = 24
  const x0 = (W - pw * 2 - gx) / 2
  const y0 = 186
  cuts.forEach((cut, i) => {
    const x = x0 + (i % 2) * (pw + gx)
    const y = y0 + Math.floor(i / 2) * (ph + gx)
    // 사진 테두리
    c.fillStyle = '#ffffff'
    roundRect(c, x - 8, y - 8, pw + 16, ph + 16, 22)
    c.fill()
    const off = document.createElement('canvas')
    off.width = pw
    off.height = ph
    const oc = off.getContext('2d')!
    d.render(oc, pw, ph, cut.shot, { banner: cut.banner ?? false, caption: '', mark: false })
    c.save()
    roundRect(c, x, y, pw, ph, 16)
    c.clip()
    c.drawImage(off, x, y)
    // 번호 · 자막
    c.fillStyle = 'rgba(29, 33, 48, 0.78)'
    c.fillRect(x, y + ph - 64, pw, 64)
    c.restore()
    c.fillStyle = '#ff7a2f'
    c.beginPath()
    c.arc(x + 34, y + 34, 22, 0, TAU)
    c.fill()
    c.fillStyle = '#ffffff'
    c.font = `bold 26px ${PIX}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(i + 1), x + 34, y + 35)
    c.font = `bold 30px ${PIX}`
    c.fillText(cut.cap, x + pw / 2, y + ph - 31)
  })

  // 아래: 이름 · 기록
  const fy = y0 + ph * 2 + gx + 34
  c.textBaseline = 'middle'
  const tag = rar.label
  c.font = `bold 26px ${PIX}`
  const tagW = c.measureText(tag).width + 28
  c.font = `bold 44px ${PIX}`
  const nameW = c.measureText(b.name).width
  const total = tagW + 16 + nameW
  let lx = (W - total) / 2
  c.fillStyle = rar.color
  roundRect(c, lx, fy - 22, tagW, 44, 12)
  c.fill()
  c.fillStyle = '#ffffff'
  c.font = `bold 26px ${PIX}`
  c.textAlign = 'left'
  c.fillText(tag, lx + 14, fy + 1)
  lx += tagW + 16
  c.font = `bold 44px ${PIX}`
  c.fillText(b.name, lx, fy + 2)
  c.textAlign = 'center'
  c.font = `28px ${PIX}`
  c.fillStyle = '#cfd6e6'
  c.fillText(statLine(r), W / 2, fy + 56)
  c.font = `22px ${PIX}`
  c.fillStyle = '#7f89a3'
  c.fillText('🕊 비둘기 모니터 — 자리를 비우면 내 화면에 비둘기가 온다', W / 2, H - 34)
  return cv.toDataURL('image/png')
}

// ───────── 영상 ─────────

/** 리플레이를 정사각 영상으로 (실시간으로 그리며 녹화한다) */
export async function recordVideo(r: Replay, e: Pick<AlbumEntry, 'isNew'>, o: { sound: boolean; size?: number; onProgress?: (k: number) => void }): Promise<{ data: Uint8Array; ext: 'mp4' | 'webm' }> {
  await document.fonts.load(`bold 40px 'Galmuri11'`).catch(() => undefined)
  const W = o.size ?? 1080
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = W
  cv.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none'
  document.body.appendChild(cv)
  const c = cv.getContext('2d')!
  const d = new ReplayDirector(r, e)
  const sfx = o.sound ? new Sfx({ speakers: false }) : null
  try {
    const stream = cv.captureStream(30)
    const audio = sfx?.captureStream()
    if (audio) for (const tr of audio.getAudioTracks()) stream.addTrack(tr)
    const types = audio
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 6_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data)
    }
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()))
    d.render(c, W, W, d.shot(0), { hud: true, banner: true })
    rec.start(500)
    const t0 = performance.now()
    let prev = 0
    await new Promise<void>((res) => {
      const loop = (): void => {
        const tau = (performance.now() - t0) / 1000
        d.render(c, W, W, d.shot(Math.min(tau, d.total)), { hud: true, banner: true })
        if (sfx) d.sounds(prev, tau, sfx)
        prev = tau
        o.onProgress?.(Math.min(1, tau / d.total))
        if (tau < d.total + 0.4) requestAnimationFrame(loop)
        else res()
      }
      requestAnimationFrame(loop)
    })
    rec.stop()
    await stopped
    const blob = new Blob(chunks, { type: rec.mimeType || mime })
    return { data: new Uint8Array(await blob.arrayBuffer()), ext: (rec.mimeType || mime).includes('mp4') ? 'mp4' : 'webm' }
  } finally {
    sfx?.close()
    cv.remove()
  }
}
