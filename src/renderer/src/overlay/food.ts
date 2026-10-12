// 모이: 클릭한 곳에서 떨어져 창 위나 바닥에 쌓인다
import type { Ground, World } from './world'

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const MAX_SEEDS = 260

export interface Seed {
  id: number
  el: HTMLElement
  x: number
  y: number
  vx: number
  vy: number
  ground: Ground | null
  /** 이 모이를 노리는 비둘기 */
  claim: number
  bounced: boolean
}

let nextId = 1

export class Food {
  seeds: Seed[] = []

  constructor(
    private layer: HTMLElement,
    private world: World
  ) {}

  get count(): number {
    return this.seeds.length
  }

  get landed(): Seed[] {
    return this.seeds.filter((s) => s.ground)
  }

  drop(x: number, y: number): number {
    const floor = this.world.floorY
    if (y > floor - 2) y = floor - 2
    const n = 7 + Math.floor(Math.random() * 5)
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div')
      el.className = `seed k${Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : 2}`
      this.layer.appendChild(el)
      this.seeds.push({
        id: nextId++,
        el,
        x: x + rand(-6, 6),
        y: y + rand(-4, 4),
        vx: rand(-70, 70),
        vy: rand(-160, 10),
        ground: null,
        claim: 0,
        bounced: false
      })
    }
    while (this.seeds.length > MAX_SEEDS) this.remove(this.seeds[0])
    return n
  }

  remove(s: Seed): void {
    s.el.remove()
    const i = this.seeds.indexOf(s)
    if (i >= 0) this.seeds.splice(i, 1)
  }

  /** 창이 움직이거나 사라지면 다시 떨어진다 */
  checkGround(): void {
    for (const s of this.seeds) {
      if (s.ground && !this.world.groundValid(s.ground)) {
        s.ground = null
        s.vy = 0
        s.vx = 0
        s.bounced = true
      }
    }
  }

  update(dt: number): void {
    const w = this.world
    for (let i = this.seeds.length - 1; i >= 0; i--) {
      const s = this.seeds[i]
      if (s.ground) {
        const p = w.groundPos(s.ground)
        if (p) {
          s.x = p.x
          s.y = p.y
        }
      } else {
        const py = s.y
        s.vy += 1700 * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vx *= Math.pow(0.5, dt)
        const hit = w.surfaceBelow(s.x, py, s.y)
        if (hit) {
          s.y = hit.y
          if (!s.bounced && s.vy > 260) {
            s.bounced = true
            s.vy = -s.vy * 0.26
            s.vx *= 0.6
          } else {
            s.ground = { wid: hit.wid, dx: s.x - hit.wx }
            s.vx = 0
            s.vy = 0
          }
        } else if (s.y > w.h + 40 || s.x < -40 || s.x > w.w + 40) {
          this.remove(s)
          continue
        }
      }
      s.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`
    }
  }

  clear(): void {
    for (const s of this.seeds) s.el.remove()
    this.seeds = []
  }
}
