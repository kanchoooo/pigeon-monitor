// 도감 자랑 이미지 (1080×1350, 인스타 세로) — 클립보드 복사 + 저장
import { BREEDS, RARITY } from '@shared/breeds'
import type { PersistedState } from '@shared/types'
import { drawPigeon, makePose } from '../pigeon/draw'

const PIX = "'Galmuri11', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"

export async function makeShareImage(state: PersistedState): Promise<string> {
  await document.fonts.load(`bold 40px 'Galmuri11'`).catch(() => undefined)
  const W = 1080
  const H = 1350
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')!

  // 배경: 광장 바닥 타일
  c.fillStyle = '#f7f2e8'
  c.fillRect(0, 0, W, H)
  c.strokeStyle = 'rgba(160, 140, 110, 0.12)'
  c.lineWidth = 2
  for (let x = 0; x < W; x += 60) {
    c.beginPath()
    c.moveTo(x, 0)
    c.lineTo(x, H)
    c.stroke()
  }
  for (let y = 0; y < H; y += 60) {
    c.beginPath()
    c.moveTo(0, y)
    c.lineTo(W, y)
    c.stroke()
  }

  const caught = state.caught
  const known = BREEDS.filter((b) => caught[b.id])
  const total = Object.values(caught).reduce((a, e) => a + (e?.total ?? 0), 0)

  c.fillStyle = '#262a35'
  c.textAlign = 'center'
  c.font = `bold 68px ${PIX}`
  c.fillText('내 화면 비둘기 도감', W / 2, 130)
  c.font = `bold 34px ${PIX}`
  c.fillStyle = '#ff7a2f'
  c.fillText(`생포 ${total}마리 · 도감 ${known.length}/${BREEDS.length}`, W / 2, 190)

  // 카드 2열 × 5행
  const cw = 470
  const ch = 196
  const gx = 40
  const top = 236
  BREEDS.forEach((b, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = (W - cw * 2 - gx) / 2 + col * (cw + gx)
    const y = top + row * (ch + 20)
    const e = caught[b.id]
    const rar = RARITY[b.rarity]
    c.fillStyle = e ? '#ffffff' : '#efe8da'
    c.strokeStyle = e ? rar.color : '#ddd3c1'
    c.lineWidth = e ? 5 : 3
    c.beginPath()
    c.roundRect(x, y, cw, ch, 28)
    c.fill()
    c.stroke()
    c.save()
    c.translate(x + 130, y + ch - 34)
    c.scale(2.7 / b.look.scale, 2.7 / b.look.scale)
    drawPigeon(c, b.look, { ...makePose(), t: 0.4 + i }, e ? {} : { silhouette: '#d6cdbb', shadow: false })
    c.restore()
    c.textAlign = 'left'
    c.fillStyle = e ? '#262a35' : '#b3aa98'
    c.font = `bold 34px ${PIX}`
    c.fillText(e ? b.name : '???', x + 238, y + 78)
    c.font = `bold 22px ${PIX}`
    c.fillStyle = rar.color
    c.fillText(rar.label, x + 238, y + 116)
    if (e) {
      c.fillStyle = '#262a35'
      c.font = `bold 30px ${PIX}`
      c.fillText(`×${e.total}`, x + 238, y + 158)
    }
  })

  c.textAlign = 'center'
  c.fillStyle = '#6d6a62'
  c.font = `24px ${PIX}`
  c.fillText('🕊 비둘기 모니터 — 자리를 비우면 내 화면에 비둘기가 온다', W / 2, H - 34)
  return cv.toDataURL('image/png')
}
