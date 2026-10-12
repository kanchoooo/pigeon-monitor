// 그림 확인용 페이지 (개발 전용, 앱에는 들어가지 않는다)
//  #sheet  품종 × 자세 표
//  #icon   앱 아이콘 (1024)
import { BREEDS } from '@shared/breeds'
import { drawPigeon, makePose, type Pose } from '../pigeon/draw'
import { drawAppIcon } from './icon'
import { makeShareImage } from '../panel/share'

const mode = location.hash.slice(1) || 'sheet'
const dpr = window.devicePixelRatio || 1

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas')
  cv.width = w * dpr
  cv.height = h * dpr
  cv.style.width = `${w}px`
  cv.style.height = `${h}px`
  document.body.appendChild(cv)
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)
  return ctx
}

const poses: [string, Partial<Pose>][] = [
  ['서기', {}],
  ['걷기1', { walk: 1, step: 0.2, headX: 2 }],
  ['걷기2', { walk: 1, step: 0.7, headX: -5 }],
  ['쪼기', { peck: 1 }],
  ['구구', { puff: 1, tailFan: 0.6 }],
  ['앉기', { sit: 1, blink: 1 }],
  ['고개', { look: -1 }],
  ['날기↑', { fly: 1, flap: 1, tilt: -0.08 }],
  ['날기→', { fly: 1, flap: 0, tilt: -0.05 }],
  ['날기↓', { fly: 1, flap: -1, tilt: -0.05 }],
  ['착지', { fly: 0.5, spread: 1, flap: 0.8, tilt: -0.25 }],
  ['왼쪽', { dir: -1 }]
]

if (mode === 'sheet') {
  const cw = 110
  const ch = 96
  const W = cw * poses.length + 120
  const H = ch * BREEDS.length + 30
  const ctx = canvas(W, H)
  ctx.font = '12px sans-serif'
  ctx.fillStyle = '#333'
  poses.forEach(([n], i) => ctx.fillText(n, 120 + i * cw + 30, 18))
  BREEDS.forEach((b, r) => {
    const y0 = 30 + r * ch
    ctx.fillStyle = r % 2 ? '#eef1f5' : '#f8f9fb'
    ctx.fillRect(0, y0, W, ch)
    // 어두운 창 테두리 위 (대비 확인)
    ctx.fillStyle = '#2a2d36'
    ctx.fillRect(120 + cw * (poses.length - 1), y0, cw, ch)
    ctx.fillStyle = '#333'
    ctx.fillText(b.name, 8, y0 + ch / 2)
    poses.forEach(([, patch], i) => {
      const p = { ...makePose(), ...patch, t: r * 0.7 } as Pose
      ctx.save()
      ctx.translate(120 + i * cw + cw / 2, y0 + ch - 16)
      ctx.strokeStyle = '#c4c9d4'
      ctx.beginPath()
      ctx.moveTo(-45, 0)
      ctx.lineTo(45, 0)
      ctx.stroke()
      drawPigeon(ctx, b.look, p)
      ctx.restore()
    })
  })
} else if (mode === 'big') {
  const ctx = canvas(900, 420)
  ctx.fillStyle = '#e9edf3'
  ctx.fillRect(0, 0, 900, 420)
  const pick = ['gray', 'checker', 'white', 'crowned', 'golden']
  pick.forEach((id, i) => {
    const b = BREEDS.find((x) => x.id === id)!
    ctx.save()
    ctx.translate(100 + i * 175, 250)
    ctx.scale(2.4, 2.4)
    drawPigeon(ctx, b.look, { ...makePose(), t: i })
    ctx.restore()
    ctx.save()
    ctx.translate(100 + i * 175, 390)
    ctx.scale(1.8, 1.8)
    drawPigeon(ctx, b.look, { ...makePose(), fly: 1, flap: 0.9, t: i })
    ctx.restore()
  })
} else if (mode === 'icon') {
  document.body.style.background = 'transparent'
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 1024
  document.body.appendChild(cv)
  drawAppIcon(cv.getContext('2d')!, 1024)
}
else if (mode === 'share') {
  const img = new Image()
  img.style.width = '540px'
  document.body.appendChild(img)
  void makeShareImage({
    settings: {} as never,
    caught: { gray: { count: 5, total: 7, first: 0 }, checker: { count: 2, total: 2, first: 0 }, chubby: { count: 1, total: 1, first: 0 }, white: { count: 1, total: 1, first: 0 }, golden: { count: 1, total: 1, first: 0 } },
    stats: { visits: 0, fed: 0, shooed: 0 },
    onboarded: true,
    album: []
  }).then((url) => (img.src = url))
}
