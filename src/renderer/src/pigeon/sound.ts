// 비둘기 효과음 — 파일 없이 WebAudio 로 합성한다

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private lastCoo = 0
  enabled = true

  /** speakers: false 면 스피커로 내보내지 않는다 (영상 녹화용) */
  constructor(private o: { speakers?: boolean } = {}) {}

  /** 영상 녹화용 오디오 트랙 */
  captureStream(): MediaStream | null {
    const ctx = this.ensure()
    if (!ctx || !this.master) return null
    const dest = ctx.createMediaStreamDestination()
    this.master.connect(dest)
    return dest.stream
  }

  close(): void {
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.master = null
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null
    try {
      if (!this.ctx) {
        const ctx = new AudioContext()
        const master = ctx.createGain()
        master.gain.value = 0.5
        if (this.o.speakers !== false) master.connect(ctx.destination)
        const len = ctx.sampleRate
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
        this.ctx = ctx
        this.master = master
        this.noise = buf
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    } catch {
      return null
    }
  }

  private out(ctx: AudioContext, pan: number): AudioNode {
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    p.connect(this.master!)
    return p
  }

  /** 구-구구-: 낮게 떨리는 울음 세 마디 */
  coo(pan = 0, pitch = 1): void {
    const ctx = this.ensure()
    if (!ctx) return
    const now = performance.now()
    if (now - this.lastCoo < 2500) return
    this.lastCoo = now
    const t0 = ctx.currentTime + 0.02
    const out = this.out(ctx, pan)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    lp.Q.value = 2
    lp.connect(out)
    const notes: [number, number, number][] = [
      [0, 0.34, 1],
      [0.42, 0.16, 0.85],
      [0.6, 0.42, 1.08]
    ]
    for (const [at, dur, k] of notes) {
      const t = t0 + at
      const f = 300 * pitch * k
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.3)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      g.connect(lp)
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(f * 0.86, t)
      o.frequency.linearRampToValueAtTime(f, t + dur * 0.4)
      o.frequency.linearRampToValueAtTime(f * 0.9, t + dur)
      // 목 떨림
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 24
      const lg = ctx.createGain()
      lg.gain.value = f * 0.035
      lfo.connect(lg).connect(o.frequency)
      o.connect(g)
      o.start(t)
      lfo.start(t)
      o.stop(t + dur + 0.05)
      lfo.stop(t + dur + 0.05)
    }
  }

  /** 푸드덕: 날개 치는 소리 */
  flap(pan = 0, beats = 5, gain = 1): void {
    const ctx = this.ensure()
    if (!ctx || !this.noise) return
    const out = this.out(ctx, pan)
    const t0 = ctx.currentTime + 0.01
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * 0.075
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 900 + Math.random() * 500
      bp.Q.value = 0.8
      const g = ctx.createGain()
      const a = 0.42 * gain * (1 - (i / beats) * 0.6)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(a, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      src.connect(bp).connect(g).connect(out)
      src.start(t, Math.random() * 0.5, 0.09)
    }
  }

  /** 톡: 모이 쪼기 */
  peck(pan = 0): void {
    const ctx = this.ensure()
    if (!ctx || !this.noise) return
    const t = ctx.currentTime + 0.005
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2500
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    src.connect(hp).connect(g).connect(this.out(ctx, pan))
    src.start(t, Math.random() * 0.5, 0.04)
  }

  /** 모이 떨어지는 소리 */
  drop(pan = 0): void {
    const ctx = this.ensure()
    if (!ctx) return
    for (let i = 0; i < 4; i++) setTimeout(() => this.peck(pan), 60 + i * 45 + Math.random() * 30)
  }

  /** 꾸룩?! (잡혔을 때) */
  squawk(pan = 0): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t = ctx.currentTime + 0.01
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(520, t)
    o.frequency.exponentialRampToValueAtTime(880, t + 0.06)
    o.frequency.exponentialRampToValueAtTime(420, t + 0.16)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1600
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(lp).connect(g).connect(this.out(ctx, pan))
    o.start(t)
    o.stop(t + 0.2)
  }

  /** 생포! 반짝 */
  caught(pan = 0, rare = false): void {
    const ctx = this.ensure()
    if (!ctx) return
    const out = this.out(ctx, pan)
    const notes = rare ? [784, 988, 1175, 1568, 1976] : [784, 1047, 1319]
    notes.forEach((f, i) => {
      const t = ctx.currentTime + 0.02 + i * 0.075
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 3200
      o.connect(lp).connect(g).connect(out)
      o.start(t)
      o.stop(t + 0.25)
    })
  }
}
