// 창 목록 → 디스플레이별 "앉을 자리" (창 윗변 중 앞 창에 가리지 않은 구간 + 화면 바닥)
import type { Display } from 'electron'
import type { Perch } from '@shared/types'
import type { WinRect } from './windows'

/** 비둘기가 서 있을 때 차지하는 높이 (이 위쪽이 다른 창에 가리면 앉지 않는다) */
const PIGEON_H = 46
const EDGE_INSET = 18

export function computePerches(wins: WinRect[], d: Display, exclude: Set<number>): { perches: Perch[]; fullscreen: boolean } {
  const B = d.bounds
  const WA = d.workArea
  const floorY = WA.y + WA.height
  const perches: Perch[] = [{ wid: 0, wx: 0, x0: 12, x1: B.width - 12, y: floorY - B.y }]
  const list = wins.filter((w) => !exclude.has(w.id) && w.w >= 120 && w.h >= 60)

  // 이 화면을 통째로 덮는 창이 있으면 전체화면 (영상·발표·게임)
  const fullscreen = list.some((w) => w.x <= B.x + 1 && w.y <= B.y + 1 && w.x + w.w >= B.x + B.width - 1 && w.y + w.h >= B.y + B.height - 1)

  for (let i = 0; i < list.length; i++) {
    const w = list[i]
    const y = w.y
    if (y < B.y || y >= floorY - 4) continue
    if (y - PIGEON_H < WA.y + 2) continue
    let segs: [number, number][] = [[Math.max(w.x + EDGE_INSET, B.x + 4), Math.min(w.x + w.w - EDGE_INSET, B.x + B.width - 4)]]
    if (segs[0][1] - segs[0][0] < 50) continue
    for (let j = 0; j < i && segs.length; j++) {
      const f = list[j]
      if (f.y < y + 3 && f.y + f.h > y - PIGEON_H) segs = subtract(segs, f.x - 10, f.x + f.w + 10)
    }
    for (const [a, b] of segs) {
      if (b - a >= 50) perches.push({ wid: w.id, wx: w.x - B.x, x0: a - B.x, x1: b - B.x, y: y - B.y })
    }
  }
  return { perches, fullscreen }
}

function subtract(segs: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = []
  for (const [s, e] of segs) {
    if (b <= s || a >= e) {
      out.push([s, e])
      continue
    }
    if (a > s) out.push([s, a])
    if (b < e) out.push([b, e])
  }
  return out
}
