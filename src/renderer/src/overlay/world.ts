// 한 화면(디스플레이)의 비둘기 세상: 앉을 자리, 모이, 비둘기 등장·퇴장, 커서·클릭 반응
import { BREED, RARITY, pickBreed, type Breed, type BreedId } from '@shared/breeds'
import type { Replay } from '@shared/replay'
import type { OverlayConfig, OverlayReport, Perch } from '@shared/types'
import { Sfx } from '../pigeon/sound'
import { Food, type Seed } from './food'
import { Fx } from './fx'
import { Pigeon } from './pigeon'

/** 창(wid) 왼쪽 기준 x 오프셋 — 창이 움직이면 같이 움직인다 */
export interface Ground {
  wid: number
  dx: number
}

interface Anchor {
  tx: number
  ty: number
  x: number
  y: number
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

/** 쫓고 있는 비둘기 주변은 클릭을 받는다 (헛손질이 뒤의 앱으로 새지 않게) */
const CHASE_R = 170

export class World {
  w = 1440
  h = 900
  /** 세상 시간 (초). 창이 숨겨져 있는 동안은 흐르지 않는다 */
  now = 0
  perches: Perch[] = []
  private anchors = new Map<number, Anchor>()
  pigeons: Pigeon[] = []
  food: Food
  fx: Fx
  sfx = new Sfx()
  cfg: OverlayConfig = { sound: true, bubbles: true, size: 1, quota: 6 }
  cursor = { x: -1e5, y: -1e5, vx: 0, vy: 0, speed: 0, at: 0 }
  away = false
  awaySince = 0
  blocked = false
  feeding = false
  private nextSpawn = Infinity
  private summonLeft = 0
  private releases: BreedId[] = []
  private lastStatus = ''

  constructor(
    public layer: HTMLElement,
    private report: (r: OverlayReport) => void
  ) {
    this.food = new Food(layer, this)
    this.fx = new Fx(layer)
  }

  get cursorPt(): { x: number; y: number } {
    return { x: this.cursor.x, y: this.cursor.y }
  }

  get floorY(): number {
    const f = this.perches.find((p) => p.wid === 0)
    return f ? f.y : this.h - 4
  }

  get alive(): Pigeon[] {
    return this.pigeons.filter((p) => p.st !== 'gone' && p.st !== 'caught' && !p.leaving)
  }

  /** 화면에 그릴 게 있는지 (없으면 루프를 쉬고 창도 숨길 수 있다) */
  get visual(): boolean {
    return this.pigeons.length > 0 || this.food.count > 0 || this.fx.busy || this.feeding
  }

  /** 생포 추격 중인 비둘기가 있다 */
  get chasing(): boolean {
    return this.pigeons.some((p) => p.st === 'chase')
  }

  /** 곧 무언가 올 예정 (비둘기 대기 중) */
  get waiting(): boolean {
    return (this.away && !this.blocked) || this.summonLeft > 0 || this.releases.length > 0
  }

  pan(x: number): number {
    return (x / this.w) * 1.4 - 0.7
  }

  // ───────── 설정·입력 ─────────

  setConfig(c: OverlayConfig): void {
    const resize = c.size !== this.cfg.size
    this.cfg = c
    this.sfx.enabled = c.sound
    if (resize) for (const p of this.pigeons) p.resize()
  }

  setPresence(away: boolean): void {
    if (away === this.away) return
    this.away = away
    if (away) {
      this.awaySince = this.now
      this.nextSpawn = Math.min(this.nextSpawn, this.now + rand(1.5, 4))
    } else {
      // 돌아왔다: 한 마리가 인사하고, 나머지는 슬슬 떠날 준비
      const here = this.alive.filter((p) => p.grounded)
      const greeter = here[Math.floor(Math.random() * here.length)]
      if (greeter) {
        greeter.say('welcome', true)
        if (greeter.st === 'rest') greeter.toStand()
      }
      for (const p of here) {
        p.leaveAt = Math.min(p.leaveAt, this.now + rand(40, 150))
        if (p !== greeter && p.st === 'rest' && Math.random() < 0.5) p.toStand()
      }
    }
  }

  setPerches(list: Perch[], blocked: boolean): void {
    this.perches = list
    if (blocked && !this.blocked) {
      // 전체화면 영상·발표가 시작됐다 → 곧 다 떠난다
      for (const p of this.alive) if (!p.tame) p.leaveAt = Math.min(p.leaveAt, this.now + rand(2, 12))
    }
    this.blocked = blocked
    const seen = new Set<number>()
    for (const p of list) {
      seen.add(p.wid)
      const a = this.anchors.get(p.wid)
      if (!a) this.anchors.set(p.wid, { tx: p.wx, ty: p.y, x: p.wx, y: p.y })
      else {
        a.tx = p.wx
        a.ty = p.y
        if (Math.abs(a.x - a.tx) > 500 || Math.abs(a.y - a.ty) > 500) {
          a.x = a.tx
          a.y = a.ty
        }
      }
    }
    for (const k of [...this.anchors.keys()]) if (!seen.has(k)) this.anchors.delete(k)
    for (const p of this.pigeons) p.checkGround()
    this.food.checkGround()
  }

  setCursor(x: number, y: number): void {
    const t = performance.now() / 1000
    const c = this.cursor
    const dt = t - c.at
    if (dt > 0 && dt < 0.25) {
      const vx = (x - c.x) / dt
      const vy = (y - c.y) / dt
      const k = Math.min(1, dt / 0.05)
      c.vx += (vx - c.vx) * k
      c.vy += (vy - c.vy) * k
      c.speed = Math.hypot(c.vx, c.vy)
    } else {
      c.vx = c.vy = c.speed = 0
    }
    c.x = x
    c.y = y
    c.at = t
  }

  setFeeding(on: boolean): void {
    this.feeding = on
  }

  summon(n: number): void {
    this.summonLeft = Math.min(12, this.summonLeft + n)
    this.nextSpawn = Math.min(this.nextSpawn, this.now + 0.2)
  }

  release(breed: BreedId): void {
    this.releases.push(breed)
    this.nextSpawn = Math.min(this.nextSpawn, this.now + 0.2)
  }

  shooAll(): void {
    this.summonLeft = 0
    for (const p of this.alive) {
      if (p.grounded) {
        p.tame = false
        p.panicAt = this.now + rand(0, 0.6)
        p.leaveAt = this.now
      } else if (p.st === 'fly' || p.st === 'chase') p.leave(true)
    }
  }

  // ───────── 자리 ─────────

  groundPos(g: Ground): { x: number; y: number } | null {
    const a = this.anchors.get(g.wid)
    return a ? { x: a.x + g.dx, y: a.y } : null
  }

  private perchOf(g: Ground): { p: Perch; a: Anchor } | null {
    const a = this.anchors.get(g.wid)
    if (!a) return null
    const x = a.tx + g.dx
    const p = this.perches.find((q) => q.wid === g.wid && x >= q.x0 - 3 && x <= q.x1 + 3)
    return p ? { p, a } : null
  }

  groundValid(g: Ground): boolean {
    return this.perchOf(g) !== null
  }

  /** 지금 서 있는 선분 안에서 움직일 수 있는 dx 범위 */
  segmentOf(g: Ground): { lo: number; hi: number } | null {
    const r = this.perchOf(g)
    if (!r) return null
    const m = Math.min(8, (r.p.x1 - r.p.x0) / 4)
    return { lo: r.p.x0 - r.a.tx + m, hi: r.p.x1 - r.a.tx - m }
  }

  sameSegment(a: Ground, b: Ground): boolean {
    if (a.wid !== b.wid) return false
    const pa = this.perchOf(a)
    const pb = this.perchOf(b)
    return !!pa && pa.p === pb?.p
  }

  /** (x, y0→y1) 로 떨어질 때 처음 닿는 면 */
  surfaceBelow(x: number, y0: number, y1: number): { y: number; wid: number; wx: number } | null {
    let best: Perch | null = null
    for (const p of this.perches) {
      if (x < p.x0 || x > p.x1) continue
      if (p.y < y0 - 1 || p.y > y1) continue
      if (!best || p.y < best.y) best = p
    }
    if (!best) return null
    const a = this.anchors.get(best.wid)
    return { y: a ? a.y : best.y, wid: best.wid, wx: a ? a.tx : best.wx }
  }

  private crowded(wid: number, x: number, y: number, r: number, self?: Pigeon): boolean {
    for (const p of this.pigeons) {
      if (p === self || p.st === 'gone' || p.leaving) continue
      const g = p.ground ?? p.target
      if (!g || g.wid !== wid) continue
      const q = this.groundPos(g)
      if (q && Math.abs(q.x - x) < r && Math.abs(q.y - y) < 6) return true
    }
    return false
  }

  /** 앉을 자리 고르기: 창 위를 바닥보다 조금 더 좋아한다 */
  pickSpot(o: { avoid?: { x: number; y: number }; avoidR?: number; self?: Pigeon } = {}): Ground | null {
    const cands = this.perches.filter((p) => p.x1 - p.x0 >= 56)
    if (!cands.length) return null
    const weights = cands.map((p) => Math.min(p.x1 - p.x0, 520) * (p.wid === 0 ? 0.55 : 1))
    const total = weights.reduce((a, b) => a + b, 0)
    const k = o.self?.k ?? this.cfg.size
    for (let tries = 0; tries < 14; tries++) {
      let r = Math.random() * total
      let p = cands[0]
      for (let i = 0; i < cands.length; i++) {
        r -= weights[i]
        if (r <= 0) {
          p = cands[i]
          break
        }
      }
      const m = Math.min(22, (p.x1 - p.x0) / 3)
      const x = rand(p.x0 + m, p.x1 - m)
      if (o.avoid && Math.hypot(x - o.avoid.x, p.y - o.avoid.y) < (o.avoidR ?? 200)) continue
      if (this.crowded(p.wid, x, p.y, 48 * k, o.self)) continue
      const a = this.anchors.get(p.wid)
      if (!a) continue
      return { wid: p.wid, dx: x - a.tx }
    }
    return null
  }

  /** 모이 근처 자리 (같은 선분 위, 조금 떨어진 곳에 내려서 걸어간다) */
  spotNear(s: Seed, self?: Pigeon): Ground | null {
    if (!s.ground) return null
    const r = this.perchOf(s.ground)
    if (!r) return null
    for (let tries = 0; tries < 10; tries++) {
      const side = Math.random() < 0.5 ? -1 : 1
      let x = s.x + side * rand(30, 85)
      x = Math.max(r.p.x0 + 10, Math.min(r.p.x1 - 10, x))
      if (this.crowded(r.p.wid, x, r.p.y, 26, self) && tries < 9) continue
      return { wid: r.p.wid, dx: x - r.a.tx }
    }
    return null
  }

  /** 가장 가까운 모이 (같은 선분 위를 먼저, 다른 비둘기가 노리는 건 피해서) */
  nearestSeed(pg: Pigeon): Seed | null {
    let best: Seed | null = null
    let bestD = Infinity
    for (const s of this.food.seeds) {
      if (!s.ground) continue
      if (s.claim && s.claim !== pg.id && this.pigeons.some((p) => p.id === s.claim && p.eating)) continue
      let d = Math.hypot(s.x - pg.x, s.y - pg.y)
      if (pg.ground && this.sameSegment(pg.ground, s.ground)) d *= 0.3
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  /** 걷는 길에 다른 비둘기가 있으면 그 앞에서 멈춘다 */
  clearPath(pg: Pigeon, to: number): number {
    if (!pg.ground) return to
    const from = pg.ground.dx
    const gap = 42 * pg.k
    let lim = to
    for (const o of this.pigeons) {
      if (o === pg || !o.ground || o.ground.wid !== pg.ground.wid || !o.grounded) continue
      const ox = o.ground.dx
      if (to > from && ox > from && ox - gap < lim) lim = Math.max(from, ox - gap)
      if (to < from && ox < from && ox + gap > lim) lim = Math.min(from, ox + gap)
    }
    return lim
  }

  exitPoint(x: number, y: number, away: { x: number; y: number } | null): { x: number; y: number } {
    let side = away ? Math.sign(x - away.x) : 0
    if (!side) side = x < this.w / 2 ? -1 : 1
    if (Math.random() < 0.25) side = -side
    return { x: side > 0 ? this.w + 160 : -160, y: rand(-160, Math.max(0, Math.min(y, this.h * 0.3))) }
  }

  entryPoint(to: { x: number; y: number }): { x: number; y: number } {
    const r = Math.random()
    if (r < 0.3) return { x: Math.max(80, Math.min(this.w - 80, to.x + rand(-500, 500))), y: -120 }
    const side = r < 0.65 ? -1 : 1
    return { x: side > 0 ? this.w + 140 : -140, y: rand(-60, Math.min(to.y - 120, this.h * 0.45)) }
  }

  canBubble(): boolean {
    return this.cfg.bubbles && this.now - this.fx.lastBubbleAt > 8 && this.fx.bubbleCount < 2
  }

  // ───────── 등장 ─────────

  private spawn(o: { breed?: Breed; tame?: boolean; seed?: Seed | null } = {}): Pigeon | null {
    const boost = this.food.count > 0 ? { chubby: 3 } : {}
    const breed = o.breed ?? pickBreed(boost)
    const pg = new Pigeon(breed, this, this.layer)
    const g = o.seed ? this.spotNear(o.seed, pg) : this.pickSpot({ self: pg })
    if (!g) {
      pg.destroy()
      return null
    }
    const end = this.groundPos(g)!
    pg.tame = !!o.tame
    pg.arrive(g, this.entryPoint(end), o.seed ? 'eat' : 'stand')
    pg.leaveAt = o.tame ? this.now + rand(60, 120) : this.away ? this.now + rand(180, 720) : this.now + rand(90, 200)
    this.pigeons.push(pg)
    this.sfx.flap(this.pan(end.x), 3, 0.35)
    if (!o.tame) this.report({ type: 'arrived', breed: breed.id })
    return pg
  }

  private spawnTick(): void {
    if (this.now < this.nextSpawn) return
    const alive = this.alive.length
    if (this.releases.length) {
      const pg = this.spawn({ breed: BREED[this.releases.shift()!], tame: true })
      if (pg) setTimeout(() => pg.say('free', true), 1400)
      this.nextSpawn = this.now + 0.7
      return
    }
    if (this.summonLeft > 0) {
      this.summonLeft--
      this.spawn()
      this.nextSpawn = this.now + rand(0.5, 1.5)
      return
    }
    const seeds = this.food.landed.length + this.food.seeds.filter((s) => !s.ground).length
    let want = this.away && !this.blocked ? this.cfg.quota : 0
    if (seeds > 0) want = Math.max(want, Math.min(this.cfg.quota + 2, 1 + Math.ceil(seeds / 9)))
    if (alive < want) {
      const seed = seeds > 0 ? this.food.landed[Math.floor(Math.random() * this.food.landed.length)] ?? null : null
      const n = seed && alive + 2 <= want && Math.random() < 0.4 ? 2 : 1
      for (let i = 0; i < n; i++) this.spawn({ seed })
      this.nextSpawn = this.now + (seeds > 0 ? rand(1.4, 3.8) : alive === 0 ? rand(0.5, 2) : rand(6, 18))
    } else this.nextSpawn = this.now + 1
  }

  /** 모이를 떨어뜨리면 근처 비둘기가 반응하고, 새 비둘기가 날아온다 */
  dropFood(x: number, y: number): void {
    const n = this.food.drop(x, y)
    this.sfx.drop(this.pan(x))
    this.report({ type: 'fed', n })
    if (this.nextSpawn > this.now + 2) this.nextSpawn = this.now + rand(0.8, 2)
    for (const p of this.alive) if (p.st === 'stand' || p.st === 'walk' || p.st === 'peck' || p.st === 'coo') p.think = Math.min(p.think, rand(0.3, 1.5))
  }

  // ───────── 상호작용 결과 ─────────

  shooed(_pg: Pigeon): void {
    this.report({ type: 'shooed', n: 1 })
  }

  /** 근처 비둘기들도 덩달아 날아간다 */
  panicAround(src: Pigeon, from: { x: number; y: number } | null): void {
    for (const p of this.alive) {
      if (p === src || p.tame || !p.grounded || p.panicAt) continue
      const d = Math.hypot(p.x - src.x, p.y - src.y)
      if (d > 230) continue
      if (p.eating && Math.random() > 0.3) continue
      p.panicAt = this.now + rand(0.06, 0.4)
    }
    void from
  }

  caught(pg: Pigeon): void {
    const b = pg.breed
    const c = pg.center
    const rar = RARITY[b.rarity]
    this.sfx.caught(this.pan(c.x), b.rarity !== 'common' && b.rarity !== 'uncommon')
    this.fx.feathersAt(c.x, c.y, b.look.wing, 9, 1.3)
    this.fx.pop(c.x, c.y - 36 * pg.k, `<span class="pop-tag" style="background:${rar.color}">${rar.label}</span><b>${b.name}</b> 생포!`, 'pop-caught')
    this.report({ type: 'caught', breed: b.id, rid: pg.rid })
  }

  /** 잡힌 장면 기록이 끝났다 → 메인이 '생포 기록'에 저장 */
  replayDone(r: Replay): void {
    this.report({ type: 'replay', replay: r })
  }

  caughtInfo(breed: BreedId, isNew: boolean, count: number): void {
    const b = BREED[breed]
    const pg = this.pigeons.find((p) => p.breed.id === breed && p.st === 'caught')
    const x = pg ? pg.x : this.cursor.x
    const y = pg ? pg.y - 92 * pg.k : this.cursor.y - 70
    if (isNew) this.fx.pop(x, y, `NEW! 도감 등록 · ${b.name}`, 'pop-new')
    else this.fx.pop(x, y, `${b.name} ×${count}`, 'pop-count')
  }

  // ───────── 클릭 ─────────

  pigeonAt(x: number, y: number): Pigeon | null {
    let best: Pigeon | null = null
    for (const p of this.pigeons) {
      if (!p.catchable || !p.hit(x, y)) continue
      if (p.st === 'chase') return p
      if (!best || p.y > best.y) best = p
    }
    return best
  }

  /** (x, y) 근처에서 쫓기고 있는 비둘기 */
  chaseNear(x: number, y: number): Pigeon | null {
    for (const p of this.pigeons) {
      if (p.st !== 'chase') continue
      const c = p.center
      if (Math.hypot(x - c.x, y - c.y) < CHASE_R * p.k) return p
    }
    return null
  }

  wantsMouse(): boolean {
    const { x, y } = this.cursor
    return this.feeding || this.pigeonAt(x, y) !== null || this.chaseNear(x, y) !== null
  }

  pointerDown(x: number, y: number): void {
    const pg = this.pigeonAt(x, y)
    if (pg) return pg.grab(x, y)
    if (this.feeding) return this.dropFood(x, y)
    const near = this.chaseNear(x, y)
    if (near) {
      this.fx.pop(x, y - 6, '휙', 'pop-miss', 0.55)
      near.nearMiss(x, y)
    }
  }

  // ───────── 매 프레임 ─────────

  update(dt: number): void {
    this.now += dt
    const k = Math.min(1, dt * 16)
    for (const a of this.anchors.values()) {
      a.x += (a.tx - a.x) * k
      a.y += (a.ty - a.y) * k
    }
    // 커서가 멈추면 속도는 빠르게 0 으로
    if (performance.now() / 1000 - this.cursor.at > 0.06) {
      this.cursor.vx *= Math.pow(0.001, dt)
      this.cursor.vy *= Math.pow(0.001, dt)
      this.cursor.speed = Math.hypot(this.cursor.vx, this.cursor.vy)
    }
    this.spawnTick()
    for (const p of this.pigeons) p.react(dt)
    for (const p of this.pigeons) p.update(dt)
    this.food.update(dt)
    this.fx.update(dt)
    for (let i = this.pigeons.length - 1; i >= 0; i--) {
      const p = this.pigeons[i]
      if (p.st === 'gone') {
        p.destroy()
        this.pigeons.splice(i, 1)
      } else p.render(dt)
    }
    this.sendStatus()
  }

  sendStatus(): void {
    const n = this.pigeons.filter((p) => p.st !== 'gone' && p.st !== 'caught').length
    const busy = this.pigeons.length > 0 || this.food.count > 0 || this.fx.busy
    const key = `${n}|${busy}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.report({ type: 'status', pigeons: n, busy })
  }

  clear(): void {
    for (const p of this.pigeons) p.destroy()
    this.pigeons = []
    this.food.clear()
    this.fx.clear()
  }
}

