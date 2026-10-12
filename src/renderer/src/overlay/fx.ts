// 화면 효과: 말풍선, 깃털, 떠오르는 글자, 생포 추격 표시
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

interface Feather {
  el: HTMLElement
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  life: number
  max: number
  sway: number
}

interface Pop {
  el: HTMLElement
  x: number
  y: number
  life: number
  max: number
}

export interface Bubble {
  el: HTMLElement
  life: number
}

export class Fx {
  private feathers: Feather[] = []
  private pops: Pop[] = []
  private bubbles = new Set<Bubble>()
  lastBubbleAt = -99

  constructor(private layer: HTMLElement) {}

  get busy(): boolean {
    return this.feathers.length > 0 || this.pops.length > 0
  }

  get bubbleCount(): number {
    return this.bubbles.size
  }

  feathersAt(x: number, y: number, color: string, n: number, spread = 1): void {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div')
      el.className = 'feather'
      el.style.background = color
      this.layer.appendChild(el)
      const max = rand(0.9, 1.6)
      this.feathers.push({
        el,
        x: x + rand(-10, 10) * spread,
        y: y + rand(-8, 8) * spread,
        vx: rand(-90, 90) * spread,
        vy: rand(-140, -30) * spread,
        rot: rand(0, 360),
        vr: rand(-300, 300),
        life: max,
        max,
        sway: rand(0, 6)
      })
    }
    if (this.feathers.length > 80) for (const f of this.feathers.splice(0, this.feathers.length - 80)) f.el.remove()
  }

  pop(x: number, y: number, html: string, cls = '', life = 1.9): void {
    const el = document.createElement('div')
    el.className = `pop ${cls}`
    el.innerHTML = html
    this.layer.appendChild(el)
    this.pops.push({ el, x, y, life, max: life })
  }

  bubble(text: string, now: number): Bubble {
    const el = document.createElement('div')
    el.className = 'bubble'
    el.textContent = text
    this.layer.appendChild(el)
    const b = { el, life: 2.4 + Math.min(1.6, text.length * 0.08) }
    this.bubbles.add(b)
    this.lastBubbleAt = now
    return b
  }

  /** 말풍선 위치 갱신. 수명이 다하면 false */
  placeBubble(b: Bubble, x: number, y: number, dt: number): boolean {
    b.life -= dt
    if (b.life <= 0) {
      this.removeBubble(b)
      return false
    }
    b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
    b.el.style.opacity = b.life < 0.3 ? String(b.life / 0.3) : '1'
    return true
  }

  removeBubble(b: Bubble): void {
    b.el.remove()
    this.bubbles.delete(b)
  }

  update(dt: number): void {
    for (let i = this.feathers.length - 1; i >= 0; i--) {
      const f = this.feathers[i]
      f.life -= dt
      if (f.life <= 0) {
        f.el.remove()
        this.feathers.splice(i, 1)
        continue
      }
      f.vy += 160 * dt
      f.vy = Math.min(f.vy, 60)
      f.vx *= Math.pow(0.15, dt)
      f.x += (f.vx + Math.sin(f.life * 6 + f.sway) * 30) * dt
      f.y += f.vy * dt
      f.rot += f.vr * dt
      f.el.style.transform = `translate3d(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px, 0) rotate(${f.rot.toFixed(0)}deg)`
      f.el.style.opacity = String(Math.min(1, f.life / (f.max * 0.4)))
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.life -= dt
      if (p.life <= 0) {
        p.el.remove()
        this.pops.splice(i, 1)
        continue
      }
      const k = 1 - p.life / p.max
      const s = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, (k - 0.12) * 0.5)
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - k * 46).toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`
      p.el.style.opacity = String(k > 0.75 ? (1 - k) / 0.25 : 1)
    }
  }

  clear(): void {
    for (const f of this.feathers) f.el.remove()
    for (const p of this.pops) p.el.remove()
    for (const b of this.bubbles) b.el.remove()
    this.feathers = []
    this.pops = []
    this.bubbles.clear()
  }
}

/** 생포 추격 표시: 맞힌 횟수(●●○○○)와 도망가기까지 남은 시간 */
export class ChaseTag {
  el: HTMLElement
  private pips: HTMLElement[] = []
  private bar: HTMLElement
  private shown = 0

  constructor(layer: HTMLElement, need: number) {
    this.el = document.createElement('div')
    this.el.className = 'chase'
    const row = document.createElement('div')
    row.className = 'pips'
    for (let i = 0; i < need; i++) {
      const p = document.createElement('i')
      row.appendChild(p)
      this.pips.push(p)
    }
    const time = document.createElement('div')
    time.className = 'time'
    this.bar = document.createElement('b')
    time.appendChild(this.bar)
    this.el.append(row, time)
    layer.appendChild(this.el)
  }

  /** left: 남은 시간 0~1 */
  set(x: number, y: number, hits: number, left: number): void {
    if (hits !== this.shown) {
      this.pips.forEach((p, i) => p.classList.toggle('on', i < hits))
      const p = this.pips[hits - 1]
      if (p && hits > this.shown) {
        p.classList.remove('bump')
        void p.offsetWidth
        p.classList.add('bump')
      }
      this.shown = hits
    }
    const v = Math.max(0, Math.min(1, left))
    this.bar.style.transform = `scaleX(${v.toFixed(3)})`
    this.bar.classList.toggle('low', v < 0.35)
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
  }

  remove(): void {
    this.el.remove()
  }
}
