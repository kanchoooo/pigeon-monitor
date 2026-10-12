import type { BreedId } from './breeds'
import type { AlbumEntry, Replay } from './replay'

export type { AlbumEntry, BreedId, Replay }

export interface Settings {
  /** 이 시간(초) 동안 마우스·키보드 입력이 없으면 비둘기가 날아온다 */
  idleSeconds: number
  /** 한 화면에 동시에 있을 수 있는 최대 비둘기 수 */
  maxPigeons: number
  /** 비둘기 크기 배율 */
  size: number
  sound: boolean
  bubbles: boolean
  /** 전체화면 앱(영상·발표·게임)이 떠 있는 화면에는 오지 않기 */
  skipFullscreen: boolean
  openAtLogin: boolean
  /** 이 시각(ms)까지 쉬기. 0 = 동작 중 */
  pausedUntil: number
}

export const DEFAULT_SETTINGS: Settings = {
  idleSeconds: 60,
  maxPigeons: 6,
  size: 1,
  sound: true,
  bubbles: true,
  skipFullscreen: true,
  openAtLogin: true,
  pausedUntil: 0
}

export const IDLE_CHOICES: { sec: number; label: string }[] = [
  { sec: 10, label: '10초 (테스트용)' },
  { sec: 30, label: '30초' },
  { sec: 60, label: '1분' },
  { sec: 180, label: '3분' },
  { sec: 300, label: '5분' },
  { sec: 600, label: '10분' }
]

export const SIZE_CHOICES: { v: number; label: string }[] = [
  { v: 0.8, label: '작게' },
  { v: 1, label: '보통' },
  { v: 1.3, label: '크게' }
]

export interface CaughtEntry {
  /** 지금 갖고 있는 수 (풀어주면 줄어든다) */
  count: number
  /** 지금까지 잡은 수 */
  total: number
  /** 처음 잡은 시각 (도감 등록) */
  first: number
}

export interface Stats {
  visits: number
  fed: number
  shooed: number
}

export interface PersistedState {
  settings: Settings
  caught: Partial<Record<BreedId, CaughtEntry>>
  stats: Stats
  onboarded: boolean
  /** 생포 기록 (최근 것부터) — 리플레이 본문은 userData/replays/<id>.json */
  album: AlbumEntry[]
}

/** 메인 → 패널: 지금 화면 상황 */
export interface LiveStatus {
  pigeons: number
  feeding: boolean
  away: boolean
  idle: number
  paused: boolean
}

/**
 * 비둘기가 앉을 수 있는 가로 선분 (오버레이 창 기준 좌표, CSS px).
 * wid 는 창 번호(0 = 화면 바닥), wx 는 그 창의 왼쪽 x.
 * 창이 움직이면 wx 가 바뀌고, 그 위에 앉은 비둘기·모이도 같이 움직인다.
 */
export interface Perch {
  wid: number
  wx: number
  x0: number
  x1: number
  y: number
}

export interface PerchUpdate {
  perches: Perch[]
  /** 새 비둘기가 오지 않는 상태 (전체화면 앱, 쉬는 중, 화면 잠금) */
  blocked: boolean
}

export interface Presence {
  away: boolean
  idle: number
}

export interface OverlayConfig {
  sound: boolean
  bubbles: boolean
  size: number
  /** 이 화면에 동시에 있을 수 있는 비둘기 수 */
  quota: number
}

export type OverlayCommand =
  | { type: 'summon'; count: number }
  | { type: 'shooAll' }
  | { type: 'release'; breed: BreedId }
  | { type: 'caughtInfo'; breed: BreedId; isNew: boolean; count: number }

export type OverlayReport =
  | { type: 'status'; pigeons: number; busy: boolean }
  | { type: 'caught'; breed: BreedId; rid?: string }
  | { type: 'replay'; replay: Replay }
  | { type: 'arrived'; breed: BreedId }
  | { type: 'fed'; n: number }
  | { type: 'shooed'; n: number }
  | { type: 'feedEnd' }

export interface OverlayApi {
  platform: string
  onInit(cb: (v: { width: number; height: number }) => void): void
  onPerches(cb: (v: PerchUpdate) => void): void
  onCursor(cb: (v: { x: number; y: number }) => void): void
  onPresence(cb: (v: Presence) => void): void
  onConfig(cb: (v: OverlayConfig) => void): void
  onFeed(cb: (on: boolean) => void): void
  onCommand(cb: (cmd: OverlayCommand) => void): void
  /** 메인이 직접 읽은 마우스 버튼 누름 (윈도우는 클릭이 렌더러에 오지 않아서) */
  onPress(cb: (v: { x: number; y: number; button: number }) => void): void
  setInteractive(on: boolean): void
  report(r: OverlayReport): void
  ready(): void
}

export interface PanelApi {
  platform: string
  getState(): Promise<PersistedState>
  setSettings(patch: Partial<Settings>): Promise<PersistedState>
  setOnboarded(): Promise<PersistedState>
  onState(cb: (s: PersistedState) => void): () => void
  getLive(): Promise<LiveStatus>
  onLive(cb: (s: LiveStatus) => void): () => void
  feed(on: boolean): Promise<void>
  summon(): Promise<void>
  shooAll(): Promise<void>
  release(breed: BreedId): Promise<boolean>
  saveImage(dataUrl: string, name?: string): Promise<'saved' | 'copied' | 'cancel'>
  /** 영상 저장 (mp4/webm) */
  saveVideo(data: Uint8Array, ext: 'mp4' | 'webm', name: string): Promise<'saved' | 'cancel'>
  getReplay(id: string): Promise<Replay | null>
  /** 영상 녹화 중엔 창이 가려져도 그리기를 늦추지 않는다 */
  setRecording(on: boolean): Promise<void>
  deleteReplay(id: string): Promise<void>
  version(): Promise<string>
  openExternal(url: string): Promise<void>
}
