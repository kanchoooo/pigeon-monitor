// 비둘기 한 마리: 상태(날기·걷기·쪼기·먹기·구구·쉬기·추격)와 그리기
import { RARITY, type Breed } from '@shared/breeds'
import { POSE_KEYS, type ChaseFrom, type Frame, type Replay } from '@shared/replay'
import { drawPigeon, makePose } from '../pigeon/draw'
import type { Seed } from './food'
import { ChaseTag, type Bubble } from './fx'
import { pickLine, type LINES } from './lines'
import type { Ground, World } from './world'

const TAU = Math.PI * 2
const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const approach = (v: number, to: number, k: number): number => v + (to - v) * Math.min(1, k)

export type St = 'fly' | 'stand' | 'walk' | 'peck' | 'eat' | 'coo' | 'rest' | 'chase' | 'caught' | 'gone'

interface Flight {
  sx: number
  sy: number
  cx: number
  cy: number
  ex: number
  ey: number
  t: number
  dur: number
  /** null = 화면 밖으로 떠난다 */
  target: Ground | null
  then: 'stand' | 'eat'
  arrive: boolean
}

/** 추격 중 한 번에 나는 구간 (굽은 길) */
interface Leg {
  sx: number
  sy: number
  cx: number
  cy: number
  ex: number
  ey: number
  t: number
  dur: number
}

interface ChaseLevel {
  /** 필요한 클릭 수 (첫 클릭 포함) */
  need: number
  /** 나는 속도 (px/s) */
  speed: number
  /** 구간 사이에 공중에서 멈칫하는 시간 */
  hover: [number, number]
  /** 이 시간 안에 다시 못 맞히면 도망 */
  patience: number
}

/** 생포 추격 난이도: 밥 먹다 쫓긴 비둘기는 느리고 금방 잡힌다 */
const CHASE: Record<'tame' | 'eat' | 'rest' | 'normal', ChaseLevel> = {
  tame: { need: 2, speed: 150, hover: [0.5, 0.9], patience: 4.5 },
  eat: { need: 3, speed: 190, hover: [0.35, 0.7], patience: 3.4 },
  rest: { need: 4, speed: 230, hover: [0.25, 0.5], patience: 2.9 },
  normal: { need: 5, speed: 270, hover: [0.15, 0.4], patience: 2.6 }
}

interface Chase extends ChaseLevel {
  hits: number
  from: St
  /** 도망가기까지 남은 시간 */
  left: number
  leg: Leg | null
  /** 공중에서 멈칫하는 남은 시간 */
  rest: number
}

const HIT_POPS = ['톡!', '탁!', '콕!', '앗!']

/** 쫓기기 전 모습도 리플레이에 넣으려고 평소엔 이만큼만 기록을 남긴다 (초) */
const REC_KEEP = 1.6
const r2 = (v: number): number => Math.round(v * 100) / 100

const DPR = (): number => Math.min(3, window.devicePixelRatio || 1)
let nextId = 1

export class Pigeon {
  readonly id = nextId++
  el: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cw = 0
  private ch = 0
  private ax = 0
  private ay = 0
  private dpr = 1
  /** 전체 크기 = 설정 크기 × 품종 크기 */
  S = 1
  pose = makePose()

  x = 0
  y = 0
  dir: 1 | -1 = 1
  ground: Ground | null = null
  st: St = 'fly'
  t = 0
  think = rand(0.8, 2.5)
  leaveAt = Infinity
  leaving = false
  tame = false
  alert = 0
  hover = 0
  panicAt = 0

  private fl: Flight | null = null
  /** 공중에서 멈칫할 때 위아래 흔들림 */
  private bobY = 0
  private walkTo = 0
  private walkV = 34
  private moving = false
  private stepPh = 0
  private peckT = -1
  private pecks = 0
  private peckHit = false
  private blinkT = rand(1, 4)
  private blinking = 0
  private lookT = 0
  private lookV = 0
  private flapPh = Math.random()
  private restUntil = 0
  private seed: Seed | null = null
  private ate = 0
  private chase: Chase | null = null
  private tag: ChaseTag | null = null
  /** 생포 리플레이 기록 */
  private rec: Frame[] = []
  private recAt = -1
  private recHits: Replay['hits'] = []
  private recMisses: Replay['misses'] = []
  private recPerches: Replay['perches'] = []
  private recFrom: ChaseFrom = 'normal'
  private chaseAt = 0
  private caughtAt = 0
  /** 리플레이 번호 (잡혔을 때 메인에 같이 알린다) */
  rid = ''
  private shake = 0
  bubble: Bubble | null = null

  constructor(
    public breed: Breed,
    private w: World,
    layer: HTMLElement
  ) {
    this.el = document.createElement('canvas')
    this.el.className = 'pg'
    this.ctx = this.el.getContext('2d')!
    layer.appendChild(this.el)
    this.resize()
  }

  get look(): Breed['look'] {
    return this.breed.look
  }

  resize(): void {
    this.S = this.w.cfg.size
    const k = this.S * this.look.scale
    this.dpr = DPR()
    this.cw = Math.ceil(132 * k)
    this.ch = Math.ceil(122 * k)
    this.ax = this.cw / 2
    this.ay = Math.round(this.ch * 0.72)
    this.el.width = Math.ceil(this.cw * this.dpr)
    this.el.height = Math.ceil(this.ch * this.dpr)
    this.el.style.width = `${this.cw}px`
    this.el.style.height = `${this.ch}px`
  }

  /** 화면에 보이는 크기 배율 */
  get k(): number {
    return this.S * this.look.scale
  }

  get grounded(): boolean {
    return this.st === 'stand' || this.st === 'walk' || this.st === 'peck' || this.st === 'eat' || this.st === 'coo' || this.st === 'rest'
  }

  /** 클릭하면 추격이 시작되거나(앉아 있거나 내려앉는 중) 이어진다 */
  get catchable(): boolean {
    return this.grounded || this.st === 'chase' || (this.st === 'fly' && !this.leaving)
  }

  /** 날아가는 중이면 내려앉을 자리 */
  get target(): Ground | null {
    return this.fl?.target ?? null
  }

  get eating(): boolean {
    return this.st === 'eat'
  }

  get center(): { x: number; y: number } {
    return { x: this.x + this.dir * 2 * this.k, y: this.y - 20 * this.k + this.bobY }
  }

  hit(px: number, py: number): boolean {
    const c = this.center
    // 날아다니는 비둘기는 조금 넉넉하게 맞는다
    const g = this.st === 'chase' ? 1.4 : 1
    const rx = 30 * this.k * g
    const ry = 24 * this.k * g
    const dx = (px - c.x) / rx
    const dy = (py - c.y) / ry
    return dx * dx + dy * dy <= 1
  }

  // ───────── 상태 전환 ─────────

  private set(st: St): void {
    if (this.st === 'eat' && st !== 'eat') this.releaseSeed()
    if (this.st === 'chase' && st !== 'chase') this.dropChase()
    this.st = st
    this.t = 0
    this.moving = false
  }

  toStand(): void {
    this.set('stand')
    this.think = rand(1, 3.2)
  }

  private releaseSeed(): void {
    if (this.seed && this.seed.claim === this.id) this.seed.claim = 0
    this.seed = null
  }

  say(kind: keyof typeof LINES, force = false): void {
    const w = this.w
    if (!w.cfg.bubbles) return
    if (!force && !w.canBubble()) return
    if (this.bubble) w.fx.removeBubble(this.bubble)
    this.bubble = w.fx.bubble(pickLine(kind, this.breed.id), w.now)
  }

  /** 화면 밖에서 날아와 g 에 내려앉는다 */
  arrive(g: Ground, from: { x: number; y: number }, then: 'stand' | 'eat' = 'stand'): void {
    this.x = from.x
    this.y = from.y
    this.flyTo(g, { then, arrive: true })
  }

  flyTo(target: Ground | null, o: { fast?: boolean; then?: 'stand' | 'eat'; arrive?: boolean; away?: { x: number; y: number } | null } = {}): void {
    const w = this.w
    if (o.then !== 'eat') this.releaseSeed()
    const sx = this.x
    const sy = this.y
    let ex: number
    let ey: number
    if (target) {
      const p = w.groundPos(target)
      if (!p) return this.flyTo(null, o)
      ex = p.x
      ey = p.y
    } else {
      const e = w.exitPoint(sx, sy, o.away ?? null)
      ex = e.x
      ey = e.y
      this.leaving = true
    }
    const dist = Math.hypot(ex - sx, ey - sy)
    const speed = o.fast ? rand(720, 920) : rand(380, 520)
    const dur = clamp(dist / speed, target ? 0.45 : 0.6, 3.6)
    let cx: number
    let cy: number
    if (!target) {
      cx = sx + (ex - sx) * 0.25
      cy = sy - rand(60, 140)
    } else if (o.arrive) {
      cx = sx + (ex - sx) * 0.7
      cy = ey - rand(70, 170)
    } else {
      cx = (sx + ex) / 2 + rand(-60, 60)
      cy = Math.min(sy, ey) - rand(40, 120) * clamp(dist / 300, 0.3, 1)
    }
    this.fl = { sx, sy, cx, cy, ex, ey, t: 0, dur, target, then: o.then ?? 'stand', arrive: !!o.arrive }
    this.ground = null
    this.set('fly')
    if (!o.arrive) w.sfx.flap(w.pan(this.x), o.fast ? 6 : 4, o.fast ? 1 : 0.6)
  }

  leave(fast: boolean, away: { x: number; y: number } | null = null): void {
    if (this.leaving && this.st === 'fly') return
    this.flyTo(null, { fast, away })
  }

  /** 놀람: 대부분 날아가 버리고, 가끔 다른 자리로 옮긴다 */
  startle(from: { x: number; y: number } | null, contagious = true): void {
    const w = this.w
    if (!this.grounded) return
    if (this.tame) {
      if (this.ground && from) this.stepAway(from, 40)
      return
    }
    if (Math.random() < 0.15) this.say('flee')
    w.fx.feathersAt(this.center.x, this.center.y, this.look.wing, 2)
    if (Math.random() < 0.8 || !this.ground) {
      this.leave(true, from)
      w.shooed(this)
    } else {
      const g = w.pickSpot({ avoid: from ?? { x: this.x, y: this.y }, avoidR: 360, self: this })
      if (g) this.flyTo(g, { fast: true })
      else {
        this.leave(true, from)
        w.shooed(this)
      }
    }
    if (contagious) w.panicAround(this, from)
  }

  /** 커서를 피해 종종걸음으로 비켜선다. 더 갈 데가 없으면 false */
  stepAway(from: { x: number; y: number }, dist = rand(35, 75)): boolean {
    if (!this.ground) return false
    const seg = this.w.segmentOf(this.ground)
    if (!seg) return false
    const side = Math.sign(this.x - from.x) || (Math.random() < 0.5 ? -1 : 1)
    const to = this.ground.dx + side * dist
    if (to < seg.lo || to > seg.hi) return false
    this.set('walk')
    this.walkTo = to
    this.walkV = 85
    this.dir = side > 0 ? 1 : -1
    return true
  }

  // ───────── 생포: 클릭하면 날아오르고, 따라가서 정해진 횟수만큼 맞히면 잡힌다 ─────────

  /** 클릭에 맞았다 (x, y: 클릭한 곳) */
  grab(x: number, y: number): void {
    const w = this.w
    if (!this.catchable) return
    const first = this.st !== 'chase'
    if (first) this.startChase()
    const c = this.chase!
    c.hits++
    this.recHits.push({ t: r2(w.now), x: r2(x), y: r2(y) })
    c.left = c.patience
    this.shake = 1
    const p = this.center
    w.fx.feathersAt(p.x, p.y, this.look.wing, 2 + Math.floor(Math.random() * 2), 0.9)
    if (c.hits >= c.need) return this.caught()
    if (first) {
      w.sfx.squawk(w.pan(p.x))
      this.say('hit', true)
      return
    }
    w.sfx.peck(w.pan(p.x))
    w.sfx.flap(w.pan(p.x), 3, 0.7)
    w.fx.pop(p.x, p.y - 22 * this.k, HIT_POPS[Math.floor(Math.random() * HIT_POPS.length)], 'pop-hit', 0.6)
    if (Math.random() < 0.3) this.say('hit', true)
    // 맞으면 휙 방향을 틀어 달아난다
    this.nextLeg(1.4)
  }

  /** 헛손질: 바로 옆을 스치면 움찔 피한다 (밥 먹다 쫓긴 비둘기는 둔하다) */
  nearMiss(x: number, y: number): void {
    const c = this.chase
    if (!c) return
    if (this.recMisses.length < 200) this.recMisses.push({ t: r2(this.w.now), x: r2(x), y: r2(y) })
    if (c.from === 'eat' || this.tame) return
    const p = this.center
    if (Math.hypot(x - p.x, y - p.y) < 70 * this.k && Math.random() < 0.5) this.nextLeg(1.3)
  }

  private startChase(): void {
    const w = this.w
    const from = this.st
    const lv = this.tame ? CHASE.tame : from === 'eat' ? CHASE.eat : from === 'rest' ? CHASE.rest : CHASE.normal
    const extra = this.tame ? 0 : RARITY[this.breed.rarity].hits
    this.releaseSeed()
    this.fl = null
    this.ground = null
    this.leaving = false
    this.set('chase')
    this.chase = { ...lv, need: lv.need + extra, speed: lv.speed * (1 + extra * 0.07), hits: 0, from, left: lv.patience, leg: null, rest: 0 }
    // 리플레이: 여기서부터 잡힐 때까지 전부 기록한다
    this.rid = `${Date.now().toString(36)}-${this.id}`
    this.chaseAt = w.now
    this.recHits = []
    this.recMisses = []
    this.recFrom = this.tame ? 'tame' : from === 'eat' ? 'eat' : from === 'rest' ? 'rest' : 'normal'
    this.recPerches = w.perches.map((q) => ({ wid: q.wid, x0: r2(q.x0), x1: r2(q.x1), y: r2(q.y) }))
    this.tag = new ChaseTag(w.layer, this.chase.need)
    w.sfx.flap(w.pan(this.x), 5, 0.9)
    this.nextLeg(1, true)
  }

  /** 다음 비행 구간: 커서 반대쪽으로, 화면 안에서 굽은 길로 */
  private nextLeg(burst = 1, takeoff = false): void {
    const w = this.w
    const c = this.chase
    if (!c) return
    const k = this.k
    const x0 = 60 * k
    const x1 = w.w - 60 * k
    const y0 = 110 * k
    const y1 = w.floorY - 24 * k
    const sx = this.x
    const sy = this.y + this.bobY
    const cur = w.cursorPt
    const away = Math.atan2(sy - 20 * k - cur.y, sx - cur.x)
    let ex = sx
    let ey = sy
    for (let i = 0; i < 10; i++) {
      // 처음엔 위로 날아오른다
      const a = (takeoff ? -Math.PI / 2 : away) + rand(-1.1, 1.1)
      const d = rand(150, 320)
      ex = clamp(sx + Math.cos(a) * d, x0, x1)
      ey = clamp(sy + Math.sin(a) * d, y0, y1)
      if (Math.hypot(ex - sx, ey - sy) > 110 && Math.hypot(ex - cur.x, ey - cur.y) > 130) break
      if (i === 9) {
        // 구석에 몰렸다 → 화면 안 아무 데로나
        ex = rand(x0, x1)
        ey = rand(y0, y1)
      }
    }
    const dist = Math.hypot(ex - sx, ey - sy) || 1
    const bend = rand(-0.35, 0.35) * dist
    // 맞을수록 지쳐서 느려진다
    const speed = c.speed * burst * Math.pow(0.95, Math.max(0, c.hits - 1))
    c.leg = {
      sx,
      sy,
      cx: (sx + ex) / 2 - ((ey - sy) / dist) * bend,
      cy: (sy + ey) / 2 + ((ex - sx) / dist) * bend,
      ex,
      ey,
      t: 0,
      dur: clamp(dist / speed, 0.35, 1.6)
    }
    this.y = sy
    this.bobY = 0
  }

  private updChase(dt: number): void {
    const c = this.chase
    if (!c) return this.leave(true)
    this.shake = Math.max(0, this.shake - dt * 3)
    c.left -= dt
    if (c.left <= 0) return this.escapeChase()
    const L = c.leg
    if (L) {
      L.t += dt
      const k = clamp(L.t / L.dur, 0, 1)
      const u = k * k * (3 - 2 * k)
      const a = (1 - u) * (1 - u)
      const b = 2 * (1 - u) * u
      const q = u * u
      const nx = a * L.sx + b * L.cx + q * L.ex
      const ny = a * L.sy + b * L.cy + q * L.ey
      const vx = (nx - this.x) / Math.max(dt, 1e-3)
      const vy = (ny - this.y) / Math.max(dt, 1e-3)
      if (Math.abs(vx) > 20) this.dir = vx > 0 ? 1 : -1
      this.x = nx
      this.y = ny
      this.pose.tilt = approach(this.pose.tilt, clamp((vy / (Math.abs(vx) + Math.abs(vy) + 1)) * 0.5, -0.4, 0.4), dt * 6)
      this.flapPh += dt * 9
      if (k >= 1) {
        c.leg = null
        c.rest = rand(c.hover[0], c.hover[1])
      }
    } else {
      // 공중에서 잠깐 멈칫 (제자리 날갯짓)
      c.rest -= dt
      this.bobY = Math.sin(this.t * 10) * 3 * this.k
      this.pose.tilt = approach(this.pose.tilt, -0.12, dt * 6)
      this.flapPh += dt * 12
      if (c.rest <= 0) this.nextLeg()
    }
  }

  /** 제때 못 맞혔다 → 도망 (밥 먹다 쫓긴 비둘기는 모이가 남아 있으면 반쯤은 다시 먹으러 온다) */
  private escapeChase(): void {
    const w = this.w
    const from = this.chase?.from
    if (from === 'eat' && w.food.count > 0 && Math.random() < 0.5 && this.goEat()) return
    if (this.tame) {
      const g = w.pickSpot({ self: this })
      if (g) return this.flyTo(g)
    }
    this.say('escape', true)
    this.leave(true, w.cursorPt)
    w.shooed(this)
  }

  private dropChase(): void {
    this.tag?.remove()
    this.tag = null
    this.chase = null
    this.bobY = 0
  }

  private caught(): void {
    this.releaseSeed()
    if (this.bubble) this.w.fx.removeBubble(this.bubble)
    this.bubble = null
    this.caughtAt = this.w.now
    this.recNeed = this.chase?.need ?? 0
    this.set('caught')
    this.w.caught(this)
  }

  private recNeed = 0

  /** 잡힌 장면 리플레이 */
  makeReplay(): Replay | null {
    const w = this.w
    const t0 = this.chaseAt - REC_KEEP
    const frames = this.rec.filter((f) => f[0] >= t0 - 0.05)
    if (frames.length < 3 || !this.rid) return null
    return {
      v: 1,
      id: this.rid,
      breed: this.breed.id,
      at: Date.now(),
      w: w.w,
      h: w.h,
      size: this.S,
      perches: this.recPerches,
      floorY: r2(w.floorY),
      frames,
      hits: this.recHits,
      misses: this.recMisses,
      chaseAt: r2(this.chaseAt),
      caughtAt: r2(this.caughtAt),
      need: this.recNeed,
      from: this.recFrom
    }
  }

  /** 프레임 기록 (초당 30번). 쫓기기 전에는 최근 것만 남긴다 */
  private record(fx: number, fy: number): void {
    const w = this.w
    if (w.now - this.recAt < 1 / 30 - 1e-4) return
    this.recAt = w.now
    const p = this.pose
    const f: Frame = [Math.round(w.now * 1000) / 1000, r2(fx), r2(fy), r2(clamp(w.cursor.x, -9999, 99999)), r2(clamp(w.cursor.y, -9999, 99999))]
    for (const k of POSE_KEYS) f.push(r2(p[k]))
    this.rec.push(f)
    if (this.st === 'chase' || this.st === 'caught') {
      if (this.rec.length > 1100) this.rec.shift()
    } else {
      while (this.rec.length && w.now - this.rec[0][0] > REC_KEEP) this.rec.shift()
    }
  }

  // ───────── 먹기 ─────────

  /** 모이를 찾아 먹으러 간다. 갈 데가 없으면 false */
  goEat(): boolean {
    const w = this.w
    const s = w.nearestSeed(this)
    if (!s || !s.ground) return false
    this.releaseSeed()
    s.claim = this.id
    this.seed = s
    if (this.ground && s.ground.wid === this.ground.wid && w.sameSegment(this.ground, s.ground)) {
      this.set('eat')
      return true
    }
    const g = w.spotNear(s, this)
    if (!g) {
      s.claim = 0
      this.seed = null
      return false
    }
    this.flyTo(g, { then: 'eat' })
    this.seed = s
    s.claim = this.id
    return true
  }

  private updEat(dt: number): void {
    const w = this.w
    const s = this.seed
    if (!s || !s.ground || !w.food.seeds.includes(s) || !this.ground || s.ground.wid !== this.ground.wid) {
      this.releaseSeed()
      if (!this.goEat()) {
        if (this.ate > 3 && Math.random() < 0.3) this.say('full')
        this.toStand()
      }
      return
    }
    const reach = 25 * this.k
    const wantDir: 1 | -1 = s.x >= this.x ? 1 : -1
    const want = s.x - wantDir * reach
    const d = want - this.x
    if (Math.abs(d) > 3 && this.peckT < 0) {
      // 먹을 자리로 걸어간다 (너무 가까우면 반대로 돌아선다)
      this.dir = Math.abs(s.x - this.x) < reach * 0.6 ? (d > 0 ? 1 : -1) : wantDir
      const step = Math.sign(d) * Math.min(Math.abs(d), 52 * dt)
      const seg = w.segmentOf(this.ground)
      if (seg) this.ground.dx = clamp(this.ground.dx + step, seg.lo, seg.hi)
      this.moving = true
      this.walkV = 52
      this.stepPh += dt / 0.24
      if (seg && (this.ground.dx <= seg.lo || this.ground.dx >= seg.hi) && Math.abs(d) > 3) {
        // 모이가 가장자리에 있으면 그냥 그 자리에서 쫀다
        this.dir = wantDir
        this.moving = false
        this.startPeck(1)
      }
      return
    }
    this.moving = false
    this.dir = wantDir
    if (this.peckT < 0) {
      if (this.t > 0.15) this.startPeck(1)
    } else if (this.peckHit) {
      this.peckHit = false
      const beak = this.x + this.dir * reach
      w.sfx.peck(w.pan(this.x))
      if (Math.abs(beak - s.x) < 11 * this.k + 3) {
        w.food.remove(s)
        this.seed = null
        this.ate++
        if (this.ate % 7 === 3 && Math.random() < 0.5) this.say('eat')
        this.t = rand(-0.2, 0.05)
      }
    }
  }

  private startPeck(n: number): void {
    this.pecks = n
    this.peckT = 0
    this.peckHit = false
  }

  // ───────── 매 프레임 ─────────

  update(dt: number): void {
    const w = this.w
    this.t += dt
    if (this.ground && this.grounded) {
      const p = w.groundPos(this.ground)
      if (p) {
        this.x = p.x
        this.y = p.y
      }
    }
    if (this.panicAt && w.now >= this.panicAt) {
      this.panicAt = 0
      if (this.grounded) this.startle(w.cursorPt, false)
    }
    // 쪼기 애니메이션
    if (this.peckT >= 0) {
      const before = this.peckT
      this.peckT += dt
      if (before < 0.11 && this.peckT >= 0.11) this.peckHit = true
      if (this.peckT >= 0.4) {
        this.pecks--
        this.peckT = this.pecks > 0 ? -rand(0.05, 0.25) : -1
      }
    } else if (this.peckT < -1e-6 && this.peckT > -1) {
      this.peckT += dt
      if (this.peckT >= 0) this.peckT = 0
    }

    switch (this.st) {
      case 'fly':
        this.updFly(dt)
        break
      case 'walk':
        this.updWalk(dt)
        break
      case 'eat':
        this.updEat(dt)
        break
      case 'chase':
        this.updChase(dt)
        break
      case 'peck':
        if (this.pecks <= 0 && this.peckT < 0) this.toStand()
        break
      case 'coo':
        if (this.t > 1.7) this.toStand()
        else if (this.t > 0.85 && this.t - dt <= 0.85) this.dir = this.dir === 1 ? -1 : 1
        break
      case 'rest':
        if (w.now > this.restUntil || !w.away) this.toStand()
        break
      case 'stand':
        this.think -= dt
        if (this.think <= 0) this.decide()
        break
      case 'caught':
        if (this.t > 0.8) {
          this.st = 'gone'
          const r = this.makeReplay()
          if (r) w.replayDone(r)
        }
        break
    }

    if (this.grounded) {
      if (w.food.count > 0) this.leaveAt = Math.max(this.leaveAt, w.now + 12)
      if (w.now > this.leaveAt && this.st !== 'eat') this.leave(false)
    }
    this.alert = Math.max(0, this.alert - dt * 0.2)
  }

  private decide(): void {
    const w = this.w
    this.think = rand(1.2, 3.8)
    if (w.food.count > 0 && this.goEat()) return
    if (this.ground) {
      const r = Math.random()
      const longAway = w.away && w.now - w.awaySince > 60
      if (longAway && r < 0.07) {
        this.set('rest')
        this.restUntil = w.now + rand(15, 50)
        if (Math.random() < 0.3) this.say('sleep')
        return
      }
      if (r < 0.48) {
        const seg = w.segmentOf(this.ground)
        if (seg) {
          const dist = rand(30, 150) * (Math.random() < 0.5 ? -1 : 1)
          let to = clamp(this.ground.dx + dist, seg.lo, seg.hi)
          to = w.clearPath(this, to)
          if (Math.abs(to - this.ground.dx) > 12) {
            this.set('walk')
            this.walkTo = to
            this.walkV = rand(26, 40)
            this.dir = to > this.ground.dx ? 1 : -1
          }
        }
      } else if (r < 0.62) {
        this.set('peck')
        this.startPeck(1 + Math.floor(Math.random() * 3))
      } else if (r < 0.77) {
        this.lookV = rand(-1, 0.5)
        this.lookT = rand(0.6, 1.6)
        if (Math.random() < 0.5) this.dir = this.dir === 1 ? -1 : 1
      } else if (r < 0.85) {
        this.set('coo')
        if (Math.random() < 0.6) w.sfx.coo(w.pan(this.x), this.look.scale > 1.1 ? 0.85 : 1)
        if (Math.random() < 0.25) this.say('idle', false)
      } else if (r < 0.88 && !this.tame) {
        const g = w.pickSpot({ self: this })
        if (g) this.flyTo(g)
      }
    }
    if (this.st === 'stand' && Math.random() < 0.12) this.say('idle')
  }

  private updWalk(dt: number): void {
    if (!this.ground) return this.toStand()
    const seg = this.w.segmentOf(this.ground)
    if (seg) this.walkTo = clamp(this.walkTo, seg.lo, seg.hi)
    const d = this.walkTo - this.ground.dx
    const step = this.walkV * dt
    this.moving = true
    this.stepPh += dt / clamp(0.36 - this.walkV * 0.0018, 0.17, 0.34)
    if (Math.abs(d) <= step) {
      this.ground.dx = this.walkTo
      this.toStand()
    } else this.ground.dx += Math.sign(d) * step
  }

  private updFly(dt: number): void {
    const f = this.fl
    const w = this.w
    if (!f) {
      this.st = 'gone'
      return
    }
    f.t += dt
    if (f.target) {
      const p = w.groundValid(f.target) ? w.groundPos(f.target) : null
      if (p) {
        f.ex = p.x
        f.ey = p.y
      } else {
        // 내려앉으려던 창이 사라졌다 → 다른 자리
        const g = w.pickSpot({ self: this })
        if (g) {
          f.target = g
        } else {
          f.target = null
          const e = w.exitPoint(this.x, this.y, null)
          f.ex = e.x
          f.ey = e.y
          this.leaving = true
        }
      }
    }
    const k = clamp(f.t / f.dur, 0, 1)
    const u = f.target ? 1 - Math.pow(1 - k, 1.7) : Math.pow(k, 1.35)
    const a = (1 - u) * (1 - u)
    const b = 2 * (1 - u) * u
    const c = u * u
    const nx = a * f.sx + b * f.cx + c * f.ex
    const ny = a * f.sy + b * f.cy + c * f.ey
    const vx = (nx - this.x) / Math.max(dt, 1e-3)
    const vy = (ny - this.y) / Math.max(dt, 1e-3)
    if (Math.abs(vx) > 8) this.dir = vx > 0 ? 1 : -1
    this.x = nx
    this.y = ny
    this.flapPh += dt * (k > 0.78 && f.target ? 11 : 7.5)
    this.pose.tilt = approach(this.pose.tilt, clamp((vy / (Math.abs(vx) + Math.abs(vy) + 1)) * 0.55, -0.45, 0.45), dt * 6)
    if (k >= 1) {
      if (f.target) {
        this.ground = f.target
        this.fl = null
        this.leaving = false
        w.sfx.flap(w.pan(this.x), 2, 0.35)
        if (f.then === 'eat' && this.goEat()) return
        this.toStand()
        this.think = rand(0.5, 1.6)
        if (f.arrive && w.away && Math.random() < 0.18) this.say('idle')
      } else {
        this.st = 'gone'
      }
    }
  }

  /** 커서 반응 (세게 휘두르면 날아가고, 다가오면 비켜선다) */
  react(dt: number): void {
    const w = this.w
    if (!this.grounded) return
    const cur = w.cursor
    const c = this.center
    const d = Math.hypot(cur.x - c.x, cur.y - c.y)
    if (d > 400) {
      this.hover = 0
      return
    }
    if (this.tame) return
    const eating = this.st === 'eat'
    const resting = this.st === 'rest'
    const fleeR = (eating ? 90 : resting ? 130 : 150) * Math.sqrt(this.k)
    const fleeV = eating ? 1900 : resting ? 1000 : 900 - this.alert * 200
    if (d < fleeR && cur.speed > fleeV) {
      this.startle(w.cursorPt)
      return
    }
    if (eating) return
    if (resting) {
      if (d < 70 && cur.speed > 120) this.toStand()
      return
    }
    // 가까이서 움직이면 비켜선다
    const nervR = 92 * Math.sqrt(this.k)
    const toward = cur.vx * (c.x - cur.x) + cur.vy * (c.y - cur.y) > 0
    if (d < nervR && cur.speed > 230 && toward && this.st !== 'walk') {
      this.alert = Math.min(1.5, this.alert + 0.45)
      if (this.alert > 1.2 && Math.random() < 0.5) return this.startle(w.cursorPt)
      if (!this.stepAway(w.cursorPt)) this.startle(w.cursorPt)
      return
    }
    // 오래 올려두면 슬금슬금 피한다
    if (this.hit(cur.x, cur.y)) {
      this.hover += dt
      if (this.hover > 1.6) {
        this.hover = 0
        this.alert += 0.3
        if (!this.stepAway(w.cursorPt)) this.startle(w.cursorPt)
      }
    } else this.hover = Math.max(0, this.hover - dt)
  }

  // ───────── 그리기 ─────────

  render(dt: number): void {
    const w = this.w
    const p = this.pose
    p.t = w.now
    p.dir = this.dir
    let walk = 0
    let headX = Math.sin(w.now * 1.3 + this.id) * 0.4
    let headY = 0
    let fly = 0
    let flap = 0
    let spread = 0
    let sit = 0
    let puff = 0
    let tailFan = 0
    let look = 0
    let tilt = 0
    let shakeX = 0
    if (this.moving) {
      walk = 1
      const vu = this.walkV / this.k
      const T = clamp(0.36 - this.walkV * 0.0018, 0.17, 0.34)
      const A = Math.min(7.5, vu * T * 0.62)
      const ph = this.stepPh % 1
      const h = 0.62
      headX = ph < h ? A / 2 - A * (ph / h) : -A / 2 + A * ((ph - h) / (1 - h))
      headY = ph >= h ? -1.4 * Math.sin((Math.PI * (ph - h)) / (1 - h)) : 0
    }
    switch (this.st) {
      case 'fly': {
        const f = this.fl
        fly = 1
        const k = f ? clamp(f.t / f.dur, 0, 1) : 0
        flap = Math.sin(this.flapPh * TAU)
        if (f && f.target && k > 0.78) {
          spread = 1
          flap = 0.62 + 0.3 * Math.sin(this.flapPh * TAU)
          fly = 0.6
        } else if (f && !f.arrive && f.t < 0.14) {
          spread = 1
          fly = 0.5 + f.t * 3.5
        }
        tilt = p.tilt
        break
      }
      case 'coo':
        puff = 1
        tailFan = 0.7
        tilt = -0.05 + Math.sin(this.t * 7) * 0.1
        headY = Math.sin(this.t * 7) * 1.2
        break
      case 'rest':
        sit = 1
        puff = 0.45
        headX = -2
        headY = 3
        break
      case 'chase':
        fly = 1
        flap = Math.sin(this.flapPh * TAU)
        if (!this.chase?.leg) {
          // 제자리 날갯짓: 날개를 크게 편다
          spread = 1
          fly = 0.8
        }
        shakeX = Math.sin(w.now * 55) * 3 * this.shake
        look = -0.4
        break
      case 'caught':
        spread = 1
        fly = 0.4
        flap = Math.sin(w.now * 42)
        break
    }
    // 쪼기
    let peck = 0
    if (this.peckT >= 0) {
      const t = this.peckT
      peck = t < 0.1 ? t / 0.1 : t < 0.16 ? 1 : t < 0.3 ? 1 - (t - 0.16) / 0.14 : 0
    }
    // 두리번
    if (this.lookT > 0) {
      this.lookT -= dt
      look = this.lookV
    }
    // 눈 깜빡임
    this.blinkT -= dt
    if (this.blinkT <= 0) {
      this.blinking = 0.13
      this.blinkT = rand(2, 6)
    }
    if (this.blinking > 0) this.blinking -= dt
    const blink = this.st === 'rest' ? (Math.sin(w.now * 0.7 + this.id) > 0.93 ? 0 : 1) : this.blinking > 0 ? 1 : 0

    const s = Math.min(1, dt * 10)
    p.walk = walk
    p.step = this.stepPh * 0.5
    p.headX = approach(p.headX, headX, this.moving ? 1 : s)
    p.headY = approach(p.headY, headY, this.moving ? 1 : s)
    p.peck = peck
    p.fly = approach(p.fly, fly, Math.min(1, dt * 12))
    p.flap = flap
    p.spread = approach(p.spread, spread, Math.min(1, dt * 14))
    p.sit = approach(p.sit, sit, Math.min(1, dt * 4))
    p.puff = approach(p.puff, puff, Math.min(1, dt * 6))
    p.tailFan = approach(p.tailFan, tailFan, s)
    p.look = approach(p.look, look, Math.min(1, dt * 8))
    p.blink = blink
    if (this.st !== 'fly' && this.st !== 'chase') p.tilt = approach(p.tilt, tilt, Math.min(1, dt * 10))

    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.el.width, this.el.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.translate(this.ax, this.ay)
    ctx.scale(this.S, this.S)
    drawPigeon(ctx, this.look, p, { shadow: this.st !== 'chase' })

    let extra = ''
    if (this.st === 'caught') {
      const k = clamp(this.t / 0.8, 0, 1)
      extra = ` rotate(${(k * 540).toFixed(0)}deg) scale(${(1 - k * k).toFixed(3)})`
      this.el.style.opacity = String(1 - k * 0.6)
    }
    const x = this.x - this.ax + shakeX
    const y = this.y - this.ay + this.bobY
    this.record(this.x + shakeX, this.y + this.bobY)
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${extra}`
    this.el.style.zIndex = String(10 + Math.round(this.y))

    const c = this.chase
    if (this.tag && c) this.tag.set(this.x, this.y - 52 * this.k + this.bobY, c.hits, c.left / c.patience)
    // 추격 중엔 맞힌 횟수 표시 위로 말풍선을 올린다
    const by = this.y - (c ? 76 : 50) * this.k + this.bobY
    if (this.bubble && !w.fx.placeBubble(this.bubble, this.x, by, dt)) this.bubble = null
  }

  checkGround(): void {
    if (!this.ground || this.st === 'fly') return
    if (!this.w.groundValid(this.ground)) {
      // 앉아 있던 창이 닫히거나 가려졌다 → 푸드덕 다른 자리로
      const g = this.w.pickSpot({ self: this })
      if (g) this.flyTo(g)
      else this.leave(false)
    }
  }

  destroy(): void {
    this.dropChase()
    if (this.bubble) this.w.fx.removeBubble(this.bubble)
    this.bubble = null
    this.releaseSeed()
    this.el.remove()
  }
}
