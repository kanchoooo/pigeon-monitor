import { BREED } from '@shared/breeds'
import { drawPigeon, makePose } from '../pigeon/draw'

/** 앱 아이콘: 하늘색 둥근 사각형 + 창 테두리 위에 앉은 비둘기 */
export function drawAppIcon(ctx: CanvasRenderingContext2D, S: number): void {
  const M = S * 0.098
  const B = S - M * 2
  const r = B * 0.2237
  ctx.save()
  ctx.translate(M, M)
  ctx.beginPath()
  ctx.roundRect(0, 0, B, B, r)
  ctx.clip()
  const g = ctx.createLinearGradient(0, 0, 0, B)
  g.addColorStop(0, '#9fd3ff')
  g.addColorStop(1, '#e6f4ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, B, B)
  // 창 (아이콘 안에 다 들어오게)
  const wx = B * 0.13
  const wy = B * 0.6
  const ww = B * 0.74
  const wh = B * 0.27
  ctx.lineWidth = B * 0.018
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#2b3550'
  ctx.beginPath()
  ctx.roundRect(wx, wy, ww, wh, B * 0.035)
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#e9eef6'
  ctx.fillRect(wx, wy, ww, B * 0.075)
  ctx.fillStyle = '#eef2f8'
  for (let i = 0; i < 3; i++) ctx.fillRect(wx + B * 0.06, wy + B * (0.11 + i * 0.045), ww * (0.7 - i * 0.18), B * 0.022)
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(wx, wy, ww, wh, B * 0.035)
  ctx.stroke()
  for (const [i, col] of ['#ff6159', '#ffbd2e', '#28c941'].entries()) {
    ctx.beginPath()
    ctx.arc(wx + B * (0.055 + i * 0.055), wy + B * 0.0375, B * 0.016, 0, Math.PI * 2)
    ctx.fillStyle = col
    ctx.fill()
  }
  ctx.restore()
  ctx.save()
  ctx.translate(M + B * 0.5, M + wy - B * 0.004)
  ctx.scale(B * 0.0112, B * 0.0112)
  drawPigeon(ctx, BREED.gray.look, { ...makePose(), headX: 1, t: 0.3 }, { shadow: false })
  ctx.restore()
}
