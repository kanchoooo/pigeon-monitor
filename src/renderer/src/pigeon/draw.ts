// 비둘기 그리기 — 이미지 파일 없이 캔버스 도형으로 그린다.
// 좌표: 오른쪽을 보는 비둘기, 원점 = 발이 닿는 바닥 가운데, 1 단위 ≈ 1 CSS px (크기 1 기준).
// 몸 길이 약 62, 키 약 42.
import type { Look } from '@shared/breeds'

export interface Pose {
  /** 1 = 오른쪽, -1 = 왼쪽 */
  dir: 1 | -1
  /** 걷기 위상 0..1 */
  step: number
  /** 0..1 다리 움직임 크기 */
  walk: number
  /** 머리 앞뒤·위아래 (걸을 때 끄덕임) */
  headX: number
  headY: number
  /** 0..1 머리를 바닥까지 */
  peck: number
  /** 0..1 목 부풀리기 (구구) */
  puff: number
  /** 0..1 웅크려 앉기 */
  sit: number
  /** 0..1 눈 감기 */
  blink: number
  /** -1(위) .. 1(아래) 고개 */
  look: number
  /** 0..1 비행 자세 */
  fly: number
  /** -1(아래) .. 1(위) 날개 */
  flap: number
  /** 0..1 날개 펼침 (착지·버둥) */
  spread: number
  /** 몸 기울기 (rad) */
  tilt: number
  /** 0..1 꼬리 펼침 */
  tailFan: number
  /** 시간 (초) — 반짝임 */
  t: number
}

export function makePose(): Pose {
  return { dir: 1, step: 0, walk: 0, headX: 0, headY: 0, peck: 0, puff: 0, sit: 0, blink: 0, look: 0, fly: 0, flap: 0, spread: 0, tilt: 0, tailFan: 0, t: 0 }
}

type Pt = [number, number]
const TAU = Math.PI * 2
const OL = 1.35
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export interface DrawOptions {
  shadow?: boolean
  /** 도감에서 아직 못 잡은 비둘기: 한 가지 색 실루엣 */
  silhouette?: string
}

export function drawPigeon(ctx: CanvasRenderingContext2D, L: Look, p: Pose, o: DrawOptions = {}): void {
  const sil = o.silhouette
  const c = (v: string): string => sil ?? v
  const line = sil ? shade(sil, -0.18) : L.line

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.scale(L.scale, L.scale)

  // 바닥 그림자
  if (o.shadow !== false && !sil) {
    const a = 0.2 * (1 - p.fly) * (1 - p.spread * 0.5)
    if (a > 0.01) {
      ctx.fillStyle = `rgba(18,20,28,${a.toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(0, 0.6, 16.5 * L.fat, 3.1, 0, 0, TAU)
      ctx.fill()
    }
  }
  ctx.scale(p.dir, 1)

  const fat = L.fat
  const fly = clamp01(p.fly)
  const sit = clamp01(p.sit) * (1 - fly)
  const hipLift = p.walk * Math.abs(Math.sin(p.step * TAU)) * 0.9
  const hipY = -9 + sit * 6.5 - hipLift
  const ground = -hipY
  ctx.translate(0, hipY)

  // 몸통 좌표 → 엉덩이 기준 좌표
  const bodyA = p.tilt + p.peck * 0.24 - p.puff * 0.1
  const ca = Math.cos(bodyA)
  const sa = Math.sin(bodyA)
  const R = (x: number, y: number): Pt => [x * ca - y * sa, x * sa + y * ca]

  // 머리 위치
  let hx = lerp(13.5 + p.headX, 18, fly)
  let hy = lerp(-25 + p.headY - Math.max(0, -p.look) * 1.6, -19, fly)
  hx = lerp(hx, 20.5, p.peck) - p.puff * 2.4
  hy = lerp(hy, ground - 6.4, p.peck) - p.puff * 1.6
  const H: Pt = [hx, hy]
  const beakA = p.look * 0.42 + p.peck * 0.9

  const open = Math.max(fly, p.spread)
  const wingTheta = Math.PI + p.flap * 1.18

  // ── 먼 쪽 날개
  if (open > 0.35) openWing(ctx, L, R(1, -17), wingTheta - 0.22 * p.flap - 0.12, 27 * (0.82 + 0.18 * open), true, c, line, !!sil)

  // ── 다리
  if (sit < 0.55) legs(ctx, L, p, fly, ground, c, line)

  // ── 꼬리
  tail(ctx, L, p, R, bodyA, fly, c, line)

  // ── 왕관 장식 (머리 뒤)
  if (L.crest === 'crown' && !sil) crown(ctx, L, H, beakA)

  // ── 몸통 + 목 + 머리: 외곽선을 하나로
  const B0 = R(8.5, -16.5)
  const neckR = (1 + p.puff * 0.38) * Math.sqrt(fat)
  const parts: (() => void)[] = []
  const fills: (string | CanvasGradient)[] = []
  const bc = R(-2, -9)
  const bodyGrad = ctx.createLinearGradient(0, -22, 0, 3)
  bodyGrad.addColorStop(0, c(L.body))
  bodyGrad.addColorStop(1, c(L.belly))
  parts.push(() => ctx.ellipse(bc[0], bc[1], 17.5 * fat, 11 * (0.9 + 0.1 * fat), bodyA - 0.2, 0, TAU))
  fills.push(bodyGrad)
  const ch = R(8, -12)
  parts.push(() => ctx.arc(ch[0], ch[1], 10 * Math.sqrt(fat) * (1 + p.puff * 0.12), 0, TAU))
  fills.push(bodyGrad)
  const neckGrad = ctx.createLinearGradient(B0[0], B0[1], H[0], H[1])
  neckGrad.addColorStop(0, c(L.neckB))
  neckGrad.addColorStop(0.55, c(L.neckA))
  neckGrad.addColorStop(1, c(L.head))
  const N = 6
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const x = lerp(B0[0], H[0], t)
    const y = lerp(B0[1], H[1], t)
    const r = lerp(7.4, 5.4, t) * neckR
    parts.push(() => ctx.arc(x, y, r, 0, TAU))
    fills.push(neckGrad)
  }
  parts.push(() => ctx.arc(H[0], H[1], 6.6, 0, TAU))
  fills.push(c(L.head))
  blob(ctx, parts, fills, line, OL)

  // 금속 광택
  if (L.shine && !sil) {
    ctx.save()
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(p.t * 2.3)
    const hl = R(-4, -17)
    const hg = ctx.createRadialGradient(hl[0], hl[1], 0, hl[0], hl[1], 14)
    hg.addColorStop(0, 'rgba(255,255,240,0.95)')
    hg.addColorStop(1, 'rgba(255,255,240,0)')
    ctx.fillStyle = hg
    ctx.beginPath()
    ctx.ellipse(hl[0], hl[1], 14, 6, bodyA - 0.2, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  // 목 무지갯빛 윤기
  if (!sil && L.pattern !== 'plain') {
    ctx.save()
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(p.t * 1.7)
    ctx.strokeStyle = L.neckA
    ctx.lineWidth = 2.2 * neckR
    ctx.beginPath()
    const m: Pt = [lerp(B0[0], H[0], 0.35), lerp(B0[1], H[1], 0.35)]
    ctx.moveTo(m[0] + 4.5 * neckR, m[1] + 2)
    ctx.quadraticCurveTo(m[0] + 6 * neckR, m[1] - 3, m[0] + 3, m[1] - 7)
    ctx.stroke()
    ctx.restore()
  }

  // ── 날개
  if (open > 0.35) openWing(ctx, L, R(2.5, -16), wingTheta, 30 * (0.82 + 0.18 * open), false, c, line, !!sil)
  else foldedWing(ctx, L, R, c, line, !!sil)

  // ── 눈·부리·장식
  head(ctx, L, p, H, beakA, c, line, !!sil)

  if (L.shine && !sil) sparkles(ctx, p.t)
  ctx.restore()
}

/** 여러 도형을 한 덩어리처럼: 외곽선을 먼저 굵게 다 그리고, 그 위에 채우기 */
function blob(ctx: CanvasRenderingContext2D, parts: (() => void)[], fills: (string | CanvasGradient)[], line: string, w: number): void {
  ctx.strokeStyle = line
  ctx.lineWidth = w * 2
  for (const b of parts) {
    ctx.beginPath()
    b()
    ctx.stroke()
  }
  for (let i = 0; i < parts.length; i++) {
    ctx.beginPath()
    parts[i]()
    ctx.fillStyle = fills[i]
    ctx.fill()
  }
}

function legs(ctx: CanvasRenderingContext2D, L: Look, p: Pose, fly: number, ground: number, c: (v: string) => string, line: string): void {
  const tuck = clamp01(fly * (1 - p.spread * 0.85))
  for (let i = 0; i < 2; i++) {
    const ax = i === 0 ? -1.5 : 3.8
    const ay = 1
    const ph = (p.step + i * 0.5) * TAU
    const lift = Math.max(0, Math.sin(ph)) * 3.2 * p.walk
    let fx = ax + 2.2 + Math.cos(ph) * 3.4 * p.walk
    let fy = ground - lift
    // 날 때는 다리를 뒤로 접는다
    fx = lerp(fx, ax - 7, tuck)
    fy = lerp(fy, ay + 3.5, tuck)
    ctx.strokeStyle = line
    ctx.lineWidth = 2.4 + OL * 1.4
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(fx, fy)
    if (tuck < 0.6) {
      ctx.moveTo(fx - 2.6, fy)
      ctx.lineTo(fx + 5, fy)
    }
    ctx.stroke()
    ctx.strokeStyle = c(L.feet)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(fx, fy)
    if (tuck < 0.6) {
      ctx.moveTo(fx - 2.6, fy)
      ctx.lineTo(fx + 5, fy)
    }
    ctx.stroke()
  }
}

function tail(
  ctx: CanvasRenderingContext2D,
  L: Look,
  p: Pose,
  R: (x: number, y: number) => Pt,
  bodyA: number,
  fly: number,
  c: (v: string) => string,
  line: string
): void {
  if (L.tailType === 'fan') {
    // 공작비둘기: 등 뒤로 세운 큰 부채 꼬리
    const C = R(-9, -12)
    const r = 21 + p.tailFan * 3
    const a0 = bodyA + Math.PI * 0.78
    const a1 = bodyA + Math.PI * 1.62
    ctx.beginPath()
    ctx.moveTo(C[0], C[1])
    ctx.arc(C[0], C[1], r, a0, a1)
    ctx.closePath()
    ctx.fillStyle = c(L.tail)
    ctx.strokeStyle = line
    ctx.lineWidth = OL
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = c(L.bar)
    ctx.lineWidth = 0.9
    ctx.beginPath()
    for (let i = 1; i < 9; i++) {
      const a = lerp(a0, a1, i / 9)
      ctx.moveTo(C[0] + Math.cos(a) * 6, C[1] + Math.sin(a) * 6)
      ctx.lineTo(C[0] + Math.cos(a) * (r - 1.5), C[1] + Math.sin(a) * (r - 1.5))
    }
    ctx.stroke()
    return
  }
  const fan = Math.max(p.tailFan, fly * 0.6)
  const droop = 1.5 - fly * 1.5
  const pts: Pt[] = [R(-14, -14.5), R(-35, -11 + droop - fan * 3.5), R(-36, -5.5 + droop + fan * 3), R(-14, -5)]
  ctx.beginPath()
  ctx.moveTo(...pts[0])
  for (const q of pts.slice(1)) ctx.lineTo(...q)
  ctx.closePath()
  ctx.fillStyle = c(L.tail)
  ctx.strokeStyle = line
  ctx.lineWidth = OL * 2
  ctx.stroke()
  ctx.fill()
  // 꼬리 끝 띠
  const band: Pt[] = [
    [lerp(pts[0][0], pts[1][0], 0.78), lerp(pts[0][1], pts[1][1], 0.78)],
    pts[1],
    pts[2],
    [lerp(pts[3][0], pts[2][0], 0.78), lerp(pts[3][1], pts[2][1], 0.78)]
  ]
  ctx.beginPath()
  ctx.moveTo(...band[0])
  for (const q of band.slice(1)) ctx.lineTo(...q)
  ctx.closePath()
  ctx.fillStyle = c(L.band)
  ctx.fill()
}

function foldedWing(ctx: CanvasRenderingContext2D, L: Look, R: (x: number, y: number) => Pt, c: (v: string) => string, line: string, sil: boolean): void {
  const path = (): void => {
    ctx.beginPath()
    ctx.moveTo(...R(9, -15))
    ctx.bezierCurveTo(...R(4, -22.5), ...R(-12, -23), ...R(-22, -16.5))
    ctx.lineTo(...R(-34, -8.5))
    ctx.bezierCurveTo(...R(-24, -3), ...R(-8, -2.2), ...R(3.5, -6))
    ctx.bezierCurveTo(...R(8, -8), ...R(10, -11), ...R(9, -15))
    ctx.closePath()
  }
  path()
  ctx.fillStyle = c(L.wing)
  ctx.fill()
  if (!sil) {
    ctx.save()
    path()
    ctx.clip()
    // 날개 끝 (첫째 날개깃)
    const g = ctx.createLinearGradient(...R(-14, -12), ...R(-26, -10))
    g.addColorStop(0, L.wing)
    g.addColorStop(1, L.tip)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(...R(-14, -26))
    ctx.lineTo(...R(-40, -26))
    ctx.lineTo(...R(-40, 4))
    ctx.lineTo(...R(-14, 4))
    ctx.closePath()
    ctx.fill()
    // 날개깃 결
    ctx.strokeStyle = shade(L.wing, -0.12)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (const k of [0, 1, 2]) {
      ctx.moveTo(...R(-17 - k * 4, -17 + k * 2.2))
      ctx.lineTo(...R(-33 + k * 1.5, -8.5 + k * 1.4))
    }
    ctx.stroke()
    if (L.pattern === 'bar') {
      ctx.strokeStyle = L.bar
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(...R(-4.5, -16))
      ctx.quadraticCurveTo(...R(-7.5, -10), ...R(-10, -4.5))
      ctx.moveTo(...R(-10.5, -16.5))
      ctx.quadraticCurveTo(...R(-13.5, -10), ...R(-16.5, -4.5))
      ctx.stroke()
    } else if (L.pattern === 'checker') {
      ctx.fillStyle = L.bar
      for (let gx = 0; gx < 5; gx++) {
        for (let gy = 0; gy < 4; gy++) {
          const x = 5 - gx * 5.2 - (gy % 2) * 2.6
          const y = -19 + gy * 4.4
          if (x < -20) continue
          const q = R(x, y)
          ctx.beginPath()
          ctx.moveTo(q[0], q[1] - 1.7)
          ctx.lineTo(q[0] + 1.5, q[1])
          ctx.lineTo(q[0], q[1] + 1.7)
          ctx.lineTo(q[0] - 1.5, q[1])
          ctx.closePath()
          ctx.fill()
        }
      }
    }
    ctx.restore()
  }
  path()
  ctx.strokeStyle = line
  ctx.lineWidth = OL * 0.9
  ctx.stroke()
}

function openWing(
  ctx: CanvasRenderingContext2D,
  L: Look,
  S: Pt,
  theta: number,
  len: number,
  far: boolean,
  c: (v: string) => string,
  line: string,
  sil: boolean
): void {
  const path = (): void => {
    ctx.save()
    ctx.translate(S[0], S[1])
    ctx.rotate(theta)
    const l = len
    ctx.beginPath()
    ctx.moveTo(0, -5)
    ctx.bezierCurveTo(l * 0.3, -8.5, l * 0.6, -8.2, l * 0.8, -6.2)
    ctx.lineTo(l * 1.0, -4.4)
    ctx.lineTo(l * 0.86, -2.3)
    ctx.lineTo(l * 1.0, -0.5)
    ctx.lineTo(l * 0.85, 1.3)
    ctx.lineTo(l * 0.97, 3.3)
    ctx.lineTo(l * 0.8, 4.5)
    ctx.lineTo(l * 0.88, 6.4)
    ctx.bezierCurveTo(l * 0.6, 8.6, l * 0.3, 8.2, 0, 5)
    ctx.closePath()
    ctx.restore()
  }
  path()
  ctx.strokeStyle = line
  ctx.lineWidth = OL * 2
  ctx.stroke()
  ctx.fillStyle = c(L.wing)
  ctx.fill()
  if (!sil) {
    ctx.save()
    path()
    ctx.clip()
    ctx.translate(S[0], S[1])
    ctx.rotate(theta)
    const g = ctx.createLinearGradient(len * 0.55, 0, len, 0)
    g.addColorStop(0, L.wing)
    g.addColorStop(1, L.tip)
    ctx.fillStyle = g
    ctx.fillRect(len * 0.5, -10, len * 0.6, 20)
    if (L.pattern === 'bar' || L.pattern === 'checker') {
      ctx.strokeStyle = L.bar
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(len * 0.3, -8)
      ctx.lineTo(len * 0.34, 8)
      ctx.moveTo(len * 0.44, -8)
      ctx.lineTo(len * 0.48, 8)
      ctx.stroke()
    }
    ctx.strokeStyle = shade(L.wing, -0.14)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (const k of [-2.3, 1.3, 4.5]) {
      ctx.moveTo(len * 0.6, k * 0.7)
      ctx.lineTo(len * 0.86, k)
    }
    ctx.stroke()
    if (far) {
      ctx.fillStyle = 'rgba(10,12,20,0.22)'
      ctx.fillRect(-4, -12, len + 8, 24)
    }
    ctx.restore()
  } else if (far) {
    path()
    ctx.fillStyle = 'rgba(10,12,20,0.12)'
    ctx.fill()
  }
}

function head(ctx: CanvasRenderingContext2D, L: Look, p: Pose, H: Pt, beakA: number, c: (v: string) => string, line: string, sil: boolean): void {
  ctx.save()
  ctx.translate(H[0], H[1])
  ctx.rotate(beakA)
  // 부리
  ctx.beginPath()
  ctx.moveTo(5.2, -2.4)
  ctx.quadraticCurveTo(9, -1.7, 12.2, 0.5)
  ctx.quadraticCurveTo(8.6, 0.7, 5.2, 1.3)
  ctx.closePath()
  ctx.fillStyle = c(L.beak)
  ctx.strokeStyle = line
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.fill()
  if (sil) {
    ctx.restore()
    return
  }
  // 콧등 (흰 납막)
  ctx.beginPath()
  ctx.ellipse(6.3, -2.2, 2.2, 1.3, -0.2, 0, TAU)
  ctx.fillStyle = L.cere
  ctx.fill()
  // 눈
  if (L.glasses) {
    ctx.strokeStyle = '#101114'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-1, -2.8)
    ctx.lineTo(-6.4, -3.6)
    ctx.stroke()
    ctx.fillStyle = '#101114'
    roundRect(ctx, -1.6, -4.5, 8.2, 4.8, 1.8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0.4, -3.4)
    ctx.lineTo(2.6, -3.4)
    ctx.stroke()
  } else if (p.blink > 0.5) {
    ctx.strokeStyle = line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(1.9, -2.2, 2, 0.25 * Math.PI, 0.75 * Math.PI)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(1.9, -1.5, 2.35, 0, TAU)
    ctx.fillStyle = L.eye
    ctx.fill()
    ctx.strokeStyle = line
    ctx.lineWidth = 0.7
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(2.25, -1.5, 1.15, 0, TAU)
    ctx.fillStyle = '#14161c'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(1.6, -2.2, 0.55, 0, TAU)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  ctx.restore()
}

function crown(ctx: CanvasRenderingContext2D, L: Look, H: Pt, beakA: number): void {
  ctx.save()
  ctx.translate(H[0], H[1])
  ctx.rotate(beakA * 0.5)
  for (let i = 0; i < 13; i++) {
    const a = lerp(-2.6, -0.7, i / 12)
    const len = 10 + Math.sin(i * 1.7) * 1.4
    const x = Math.cos(a) * len - 1
    const y = Math.sin(a) * len - 3
    ctx.strokeStyle = L.bar
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(-1, -4)
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(x, y, 2.1, 1.3, a, 0, TAU)
    ctx.fillStyle = '#a9bdf0'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 0.75, 0, TAU)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  ctx.restore()
}

function sparkles(ctx: CanvasRenderingContext2D, t: number): void {
  const spots: Pt[] = [
    [-24, -30],
    [6, -44],
    [-8, -26],
    [20, -14],
    [-30, -6]
  ]
  spots.forEach(([x, y], i) => {
    const a = Math.max(0, Math.sin(t * 3.1 + i * 1.9))
    if (a < 0.05) return
    const s = 1.5 + a * 2.6
    ctx.save()
    ctx.globalAlpha = a
    ctx.fillStyle = '#fff6c8'
    ctx.beginPath()
    ctx.moveTo(x, y - s * 1.6)
    ctx.quadraticCurveTo(x, y, x + s * 1.6, y)
    ctx.quadraticCurveTo(x, y, x, y + s * 1.6)
    ctx.quadraticCurveTo(x, y, x - s * 1.6, y)
    ctx.quadraticCurveTo(x, y, x, y - s * 1.6)
    ctx.fill()
    ctx.restore()
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** #rrggbb 밝기 조절 (amt -1..1) */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number): number => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
