// 생포 리플레이: 비둘기가 잡히기까지를 화면 녹화 대신 '위치·자세 기록'으로 남긴다.
// 내 화면 내용은 담기지 않고, 다시 볼 때 창 모양만 단순하게 다시 그린다.
import type { BreedId } from './breeds'

/** 프레임에 기록하는 자세 값 (순서 고정) */
export const POSE_KEYS = ['dir', 'step', 'walk', 'headX', 'headY', 'peck', 'puff', 'sit', 'blink', 'look', 'fly', 'flap', 'spread', 'tilt', 'tailFan'] as const

/** 프레임: [t, x, y, 커서x, 커서y, ...POSE_KEYS] — x, y 는 발 위치(흔들림 포함), t 는 세상 시간(초) */
export type Frame = number[]
export const FI = { t: 0, x: 1, y: 2, cx: 3, cy: 4, pose: 5 } as const

export type ChaseFrom = 'eat' | 'rest' | 'tame' | 'normal'

export interface Replay {
  v: 1
  id: string
  breed: BreedId
  /** 잡은 시각 (Date.now) */
  at: number
  /** 화면 크기 (CSS px) */
  w: number
  h: number
  /** 비둘기 크기 설정 */
  size: number
  /** 그때 앉을 수 있던 자리 (창 윗변·바닥) — 배경을 그릴 때 쓴다 */
  perches: { wid: number; x0: number; x1: number; y: number }[]
  floorY: number
  frames: Frame[]
  hits: { t: number; x: number; y: number }[]
  misses: { t: number; x: number; y: number }[]
  /** 첫 클릭(추격 시작) · 잡힌 시각 (세상 시간, 초) */
  chaseAt: number
  caughtAt: number
  need: number
  from: ChaseFrom
}

/** 도감 '생포 기록' 목록에 보이는 요약 (리플레이 본문은 따로 파일로) */
export interface AlbumEntry {
  id: string
  breed: BreedId
  at: number
  need: number
  /** 첫 클릭부터 잡힐 때까지 (초) */
  secs: number
  from: ChaseFrom
  isNew: boolean
}

export const FROM_LABEL: Record<ChaseFrom, string> = {
  eat: '밥 먹다가',
  rest: '졸다가',
  tame: '풀어준 비둘기',
  normal: '한눈팔다가'
}

/** 들어온 리플레이가 멀쩡한지 (메인에서 저장 전에 확인) */
export function validReplay(r: unknown): r is Replay {
  const x = r as Replay
  return (
    !!x &&
    x.v === 1 &&
    typeof x.id === 'string' &&
    /^[a-z0-9-]{4,40}$/.test(x.id) &&
    typeof x.breed === 'string' &&
    Array.isArray(x.frames) &&
    x.frames.length > 2 &&
    x.frames.length <= 1200 &&
    x.frames.every((f) => Array.isArray(f) && f.length === FI.pose + POSE_KEYS.length && f.every((v) => typeof v === 'number' && Number.isFinite(v))) &&
    Array.isArray(x.hits) &&
    x.hits.length <= 40 &&
    Array.isArray(x.misses) &&
    x.misses.length <= 200 &&
    Array.isArray(x.perches) &&
    x.perches.length <= 200 &&
    [x.w, x.h, x.size, x.floorY, x.chaseAt, x.caughtAt, x.need, x.at].every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}
