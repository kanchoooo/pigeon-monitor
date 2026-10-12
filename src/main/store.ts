import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { BREED, type BreedId } from '@shared/breeds'
import type { AlbumEntry, Replay } from '@shared/replay'
import type { CaughtEntry, PersistedState, Settings, Stats } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

type Listener = (s: PersistedState) => void

/** userData/state.json 에 저장되는 아주 작은 JSON 저장소 */
export class Store {
  private file: string
  private listeners = new Set<Listener>()
  private saveTimer: NodeJS.Timeout | null = null
  state: PersistedState

  constructor() {
    this.file = join(app.getPath('userData'), 'state.json')
    this.state = this.load()
  }

  private load(): PersistedState {
    const fresh: PersistedState = {
      settings: { ...DEFAULT_SETTINGS },
      caught: {},
      stats: { visits: 0, fed: 0, shooed: 0 },
      onboarded: false,
      album: []
    }
    try {
      if (!existsSync(this.file)) return fresh
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PersistedState>
      const caught: PersistedState['caught'] = {}
      for (const [id, e] of Object.entries(raw.caught ?? {})) {
        if (!(id in BREED) || !e) continue
        const c = e as Partial<CaughtEntry>
        caught[id as BreedId] = { count: Math.max(0, Number(c.count) || 0), total: Math.max(0, Number(c.total) || 0), first: Number(c.first) || Date.now() }
      }
      return {
        settings: sanitize({ ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }),
        caught,
        stats: { ...fresh.stats, ...(raw.stats ?? {}) },
        onboarded: !!raw.onboarded,
        album: Array.isArray(raw.album) ? raw.album.filter((a) => a && typeof a.id === 'string' && /^[a-z0-9-]{4,40}$/.test(a.id) && a.breed in BREED).slice(0, ALBUM_MAX) : []
      }
    } catch (err) {
      console.error('[store] load failed, starting fresh', err)
      return fresh
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[store] save failed', err)
    }
  }

  /** 통계처럼 자주 바뀌는 값은 모아서 저장 */
  private saveSoon(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, 3000)
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.save()
    }
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private commit(next: PersistedState, lazy = false): PersistedState {
    this.state = next
    if (lazy) this.saveSoon()
    else this.save()
    for (const l of this.listeners) l(next)
    return next
  }

  setSettings(patch: Partial<Settings>): PersistedState {
    return this.commit({ ...this.state, settings: sanitize({ ...this.state.settings, ...patch }) })
  }

  setOnboarded(): PersistedState {
    return this.commit({ ...this.state, onboarded: true })
  }

  /** 생포. 처음 잡은 품종이면 isNew */
  addCaught(id: BreedId): { isNew: boolean; count: number } {
    const prev = this.state.caught[id]
    const e: CaughtEntry = prev ? { ...prev, count: prev.count + 1, total: prev.total + 1 } : { count: 1, total: 1, first: Date.now() }
    this.commit({ ...this.state, caught: { ...this.state.caught, [id]: e } })
    return { isNew: !prev, count: e.count }
  }

  /** 풀어주기: 갖고 있는 수를 하나 줄인다 (도감 기록은 남는다) */
  takeOne(id: BreedId): boolean {
    const prev = this.state.caught[id]
    if (!prev || prev.count <= 0) return false
    this.commit({ ...this.state, caught: { ...this.state.caught, [id]: { ...prev, count: prev.count - 1 } } })
    return true
  }

  // ───────── 생포 기록 (리플레이) ─────────

  private get replayDir(): string {
    return join(app.getPath('userData'), 'replays')
  }

  /** 리플레이를 파일로 저장하고 목록 맨 앞에 넣는다. 오래된 것은 지운다 */
  addReplay(r: Replay, isNew: boolean): void {
    try {
      mkdirSync(this.replayDir, { recursive: true })
      writeFileSync(join(this.replayDir, `${r.id}.json`), JSON.stringify(r))
    } catch (err) {
      console.error('[store] replay save failed', err)
      return
    }
    const entry: AlbumEntry = { id: r.id, breed: r.breed, at: r.at, need: r.need, secs: Math.max(0, Math.round((r.caughtAt - r.chaseAt) * 10) / 10), from: r.from, isNew }
    const album = [entry, ...this.state.album.filter((a) => a.id !== r.id)]
    for (const old of album.splice(ALBUM_MAX)) this.removeReplayFile(old.id)
    this.commit({ ...this.state, album })
  }

  getReplay(id: string): Replay | null {
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return null
    try {
      return JSON.parse(readFileSync(join(this.replayDir, `${id}.json`), 'utf8')) as Replay
    } catch {
      return null
    }
  }

  deleteReplay(id: string): void {
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return
    this.removeReplayFile(id)
    this.commit({ ...this.state, album: this.state.album.filter((a) => a.id !== id) })
  }

  private removeReplayFile(id: string): void {
    try {
      rmSync(join(this.replayDir, `${id}.json`), { force: true })
    } catch {
      /* 없으면 그만 */
    }
  }

  bump(key: keyof Stats, n = 1): void {
    this.commit({ ...this.state, stats: { ...this.state.stats, [key]: this.state.stats[key] + n } }, true)
  }
}

/** 생포 기록은 최근 이만큼만 남긴다 */
const ALBUM_MAX = 40

function sanitize(s: Settings): Settings {
  return {
    ...s,
    idleSeconds: Math.max(5, Math.min(3600, Math.round(Number(s.idleSeconds) || DEFAULT_SETTINGS.idleSeconds))),
    maxPigeons: Math.max(1, Math.min(15, Math.round(Number(s.maxPigeons) || DEFAULT_SETTINGS.maxPigeons))),
    size: Math.max(0.6, Math.min(1.6, Number(s.size) || 1)),
    pausedUntil: Number(s.pausedUntil) || 0
  }
}
