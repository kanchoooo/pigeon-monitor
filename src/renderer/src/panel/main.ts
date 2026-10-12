// 비둘기 모니터 패널: 홈(상태·버튼) · 도감 · 생포 기록(리플레이) · 설정
import './panel.css'
import { BREEDS, BREED, RARITY, type BreedId } from '@shared/breeds'
import { FROM_LABEL, type AlbumEntry, type Replay } from '@shared/replay'
import { IDLE_CHOICES, SIZE_CHOICES, type LiveStatus, type PersistedState, type Settings } from '@shared/types'
import { drawPigeon, makePose, type Pose } from '../pigeon/draw'
import { Sfx } from '../pigeon/sound'
import { makeFourCut, recordVideo, ReplayDirector } from './replay'
import { makeShareImage } from './share'

const api = window.api
const app = document.getElementById('app')!
document.body.classList.add(api.platform === 'darwin' ? 'mac' : 'win')

type Tab = 'home' | 'dex' | 'album' | 'settings'

let state: PersistedState
let live: LiveStatus = { pigeons: 0, feeding: false, away: false, idle: 0, paused: false }
let selected: BreedId | null = null
let version = ''
let tab: Tab = 'home'
/** 생포 기록에서 열어 둔 리플레이 */
let openId: string | null = null

const DPR = Math.min(3, window.devicePixelRatio || 1)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (html) e.innerHTML = html
  return e
}

function pigeonCanvas(w: number, h: number, id: BreedId, known: boolean, scale: number, pose: Partial<Pose> = {}): HTMLCanvasElement {
  const cv = el('canvas')
  cv.width = w * DPR
  cv.height = h * DPR
  cv.style.width = `${w}px`
  cv.style.height = `${h}px`
  const c = cv.getContext('2d')!
  c.scale(DPR, DPR)
  c.translate(w / 2 + 2, h - 6)
  c.scale(scale / BREED[id].look.scale, scale / BREED[id].look.scale)
  drawPigeon(c, BREED[id].look, { ...makePose(), t: 0.4, ...pose }, known ? {} : { silhouette: '#d8d0c0', shadow: false })
  return cv
}

// ── 머리 위 걷는 비둘기 (장식)
function heroPigeon(): HTMLCanvasElement {
  const W = 76
  const H = 56
  const cv = el('canvas')
  cv.width = W * DPR
  cv.height = H * DPR
  cv.style.width = `${W}px`
  cv.style.height = `${H}px`
  const c = cv.getContext('2d')!
  let ph = 0
  let dir: 1 | -1 = 1
  let x = 0
  let last = performance.now()
  let peck = -1
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (peck >= 0) {
      peck += dt
      if (peck > 0.9) peck = -1
    } else {
      x += dir * 16 * dt
      ph += dt / 0.3
      if (Math.abs(x) > 10) {
        dir = dir === 1 ? -1 : 1
        x = Math.sign(x) * 10
        peck = 0
      }
    }
    const p = makePose()
    p.dir = dir
    p.t = now / 1000
    if (peck >= 0) {
      const t = peck % 0.45
      p.peck = t < 0.1 ? t / 0.1 : t < 0.16 ? 1 : t < 0.3 ? 1 - (t - 0.16) / 0.14 : 0
    } else {
      const f = ph % 1
      const A = 4
      p.walk = 1
      p.step = ph * 0.5
      p.headX = f < 0.62 ? A / 2 - A * (f / 0.62) : -A / 2 + A * ((f - 0.62) / 0.38)
    }
    c.setTransform(DPR, 0, 0, DPR, 0, 0)
    c.clearRect(0, 0, W, H)
    c.strokeStyle = '#d9cfbb'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(4, H - 7)
    c.lineTo(W - 4, H - 7)
    c.stroke()
    c.translate(W / 2 + x, H - 8)
    c.scale(0.9, 0.9)
    drawPigeon(c, BREED.gray.look, p)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  return cv
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(msg: string): void {
  let t = document.querySelector('.toast') as HTMLElement | null
  if (!t) {
    t = el('div', { class: 'toast' })
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t!.classList.remove('show'), 2600)
}

function fmtIdle(sec: number): string {
  return sec < 60 ? `${sec}초` : `${Math.round(sec / 60)}분`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const totalCaught = (): number => Object.values(state.caught).reduce((a, e) => a + (e?.total ?? 0), 0)

// ───────── 탭 ─────────

const TABS: { id: Tab; ico: string; label: string }[] = [
  { id: 'home', ico: '🏠', label: '홈' },
  { id: 'dex', ico: '📖', label: '도감' },
  { id: 'album', ico: '🎬', label: '생포 기록' },
  { id: 'settings', ico: '⚙️', label: '설정' }
]
const tabBar = el('nav', { class: 'tabs' })
const views: Record<Tab, HTMLElement> = {
  home: el('section', { class: 'view' }),
  dex: el('section', { class: 'view' }),
  album: el('section', { class: 'view' }),
  settings: el('section', { class: 'view' })
}

function renderTabs(): void {
  tabBar.innerHTML = ''
  for (const t of TABS) {
    const n = t.id === 'album' && state.album.length ? `<i class="badge">${state.album.length}</i>` : ''
    const b = el('button', { class: `tab${tab === t.id ? ' on' : ''}` }, `<span class="ico">${t.ico}</span>${t.label}${n}`)
    b.onclick = () => setTab(t.id)
    tabBar.appendChild(b)
  }
}

function setTab(t: Tab): void {
  if (t !== 'album') stopPlayer()
  tab = t
  for (const [k, v] of Object.entries(views)) v.hidden = k !== t
  renderTabs()
  if (t === 'album') renderAlbum()
  window.scrollTo({ top: 0 })
}

// ───────── 홈: 상태 카드 ─────────

const statusCard = el('section', { class: 'card' })
function renderStatus(): void {
  const s = state.settings
  const th = s.idleSeconds
  let cls = ''
  let title = ''
  let sub = ''
  let pct = 0
  if (live.feeding) {
    cls = 'feeding'
    title = '모이 주는 중 🌾'
    sub = '화면 아무 데나 클릭하면 모이가 떨어져요 · ESC 로 끝'
  } else if (live.paused) {
    title = '잠시 쉬는 중'
    sub = `${new Date(s.pausedUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지 비둘기가 오지 않아요`
  } else if (live.pigeons > 0) {
    cls = 'here'
    title = `지금 화면에 비둘기 ${live.pigeons}마리`
    sub = '클릭하고 쫓아가 맞히면 생포!'
  } else if (live.away) {
    cls = 'here'
    title = '비둘기가 오는 중…'
    sub = '창 위나 화면 아래를 지켜보세요'
    pct = 100
  } else {
    title = `${fmtIdle(th)} 동안 가만히 있으면 비둘기가 와요`
    const left = Math.max(0, th - live.idle)
    sub = live.idle >= 3 ? `${live.idle}초째 조용… ${left}초 남았어요` : '컴퓨터를 쓰는 동안은 오지 않아요'
    pct = Math.min(100, (live.idle / th) * 100)
  }
  statusCard.innerHTML = `
    <div class="status ${cls}"><div class="dot"></div><div class="text"><b>${title}</b><span>${sub}</span></div></div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>`
  if (live.paused) {
    const b = el('button', { class: 'small-btn', style: 'margin-top:10px' }, '다시 시작하기')
    b.onclick = () => void api.setSettings({ pausedUntil: 0 })
    statusCard.appendChild(b)
  }
  renderActions()
}

// ───────── 홈: 버튼 ─────────

const actions = el('div', { class: 'actions' })
const tip = el('p', { class: 'tip' }, '💡 비둘기를 <b>클릭</b>하면 날아올라요. <b>쫓아가서 동그라미가 다 찰 때까지</b> 맞히면 생포! <b>밥 먹는 중</b>이면 느려서 잡기 쉬워요.')
function renderActions(): void {
  actions.innerHTML = ''
  const feed = el(
    'button',
    { class: `btn ${live.feeding ? 'on' : 'primary'}` },
    live.feeding ? '<span class="ico">✋</span>그만 주기<small>ESC · 우클릭</small>' : '<span class="ico">🌾</span>모이 주기<small>클릭해서 뿌리기</small>'
  )
  feed.onclick = () => void api.feed(!live.feeding)
  const call = el('button', { class: 'btn' }, '<span class="ico">🕊</span>지금 부르기<small>바로 날아와요</small>')
  call.onclick = () => {
    void api.summon()
    toast('비둘기를 불렀어요! 화면을 보세요 🕊')
  }
  const shoo = el('button', { class: 'btn' }, '<span class="ico">💨</span>모두 쫓기<small>훠이 훠이</small>')
  shoo.onclick = () => void api.shooAll()
  ;(shoo as HTMLButtonElement).disabled = live.pigeons === 0 && !live.feeding
  actions.append(feed, call, shoo)
}

// ───────── 홈: 최근 생포 ─────────

const recentCard = el('section', { class: 'card' })
function renderRecent(): void {
  const a = state.album[0]
  recentCard.hidden = !a
  if (!a) return
  recentCard.innerHTML = ''
  recentCard.appendChild(el('h2', {}, '🎬 최근 생포 <span class="count">눌러서 리플레이</span>'))
  const row = albumRow(a)
  row.onclick = () => openReplay(a.id)
  recentCard.appendChild(row)
}

const homeFooter = el('footer')
function renderHomeFooter(): void {
  const st = state.stats
  homeFooter.textContent = `다녀간 비둘기 ${st.visits} · 모이 ${st.fed}알 · 쫓아낸 비둘기 ${st.shooed} · 생포 ${totalCaught()}`
}

// ───────── 도감 ─────────

const dexCard = el('section', { class: 'card' })
function renderDex(): void {
  const caught = state.caught
  const known = BREEDS.filter((b) => caught[b.id])
  dexCard.innerHTML = ''
  const h = el('h2', {}, `📖 비둘기 도감 <span class="count">${known.length}/${BREEDS.length} · 생포 ${totalCaught()}마리</span><span class="spacer"></span>`)
  const share = el('button', { class: 'small-btn' }, '📸 자랑하기')
  share.onclick = async () => {
    const url = await makeShareImage(state)
    const r = await api.saveImage(url, '내-비둘기-도감')
    if (r === 'saved') toast('이미지를 저장하고 클립보드에도 복사했어요')
    else if (r === 'copied') toast('클립보드에 복사했어요 — 붙여넣기 하세요')
  }
  h.appendChild(share)
  dexCard.appendChild(h)

  const grid = el('div', { class: 'dex' })
  for (const b of BREEDS) {
    const e = caught[b.id]
    const cell = el('button', { class: `cell${e ? '' : ' unknown'}${selected === b.id ? ' sel' : ''}`, title: e ? b.name : '아직 못 잡았어요' })
    cell.appendChild(pigeonCanvas(66, 52, b.id, !!e, 0.95))
    cell.appendChild(el('span', { class: 'nm' }, e ? b.name : '???'))
    if (e && e.count > 0) cell.appendChild(el('span', { class: 'n' }, `×${e.count}`))
    cell.appendChild(el('span', { class: 'r', style: `background:${RARITY[b.rarity].color}` }))
    cell.onclick = () => {
      selected = selected === b.id ? null : b.id
      renderDex()
    }
    grid.appendChild(cell)
  }
  dexCard.appendChild(grid)

  if (!selected) {
    dexCard.appendChild(el('p', { class: 'hint' }, '칸을 누르면 자세히 볼 수 있어요. 왼쪽 위 색 점은 희귀도예요.'))
    return
  }
  const b = BREED[selected]
  const e = caught[selected]
  const d = el('div', { class: 'detail' })
  d.appendChild(pigeonCanvas(84, 68, b.id, !!e, 1.15))
  const info = el('div', { class: 'info' })
  const rar = RARITY[b.rarity]
  if (e) {
    info.innerHTML = `<b>${b.name}</b><span class="tag" style="background:${rar.color}">${rar.label}</span>
      <p>${b.desc}</p>
      <div class="meta">보유 ${e.count} · 누적 ${e.total} · 처음 잡은 날 ${new Date(e.first).toLocaleDateString('ko-KR')}</div>`
  } else {
    info.innerHTML = `<b>???</b><span class="tag" style="background:${rar.color}">${rar.label}</span>
      <p>아직 못 잡은 비둘기예요. ${b.rarity === 'legendary' ? '아주 가끔, 정말 가끔 나타난대요.' : b.rarity === 'epic' || b.rarity === 'rare' ? '드물게 나타나요.' : '자주 와요. 금방 만날 거예요!'}</p>`
  }
  if (e && e.count > 0) {
    const rel = el('button', { class: 'small-btn' }, '풀어주기')
    rel.title = '한 마리를 화면에 풀어줘요 (도감 기록은 남아요)'
    rel.onclick = async () => {
      if (await api.release(b.id)) toast(`${b.name}를 풀어줬어요 🕊`)
    }
    info.appendChild(rel)
  }
  d.appendChild(info)
  dexCard.appendChild(d)
}

// ───────── 생포 기록 ─────────

const albumCard = el('section', { class: 'card' })
const replays = new Map<string, Promise<Replay | null>>()
function loadReplay(id: string): Promise<Replay | null> {
  let p = replays.get(id)
  if (!p) {
    p = api.getReplay(id)
    replays.set(id, p)
  }
  return p
}

/** 목록 한 줄: 클로즈업 썸네일 + 이름 + 기록 */
function albumRow(a: AlbumEntry): HTMLButtonElement {
  const b = BREED[a.breed]
  const rar = RARITY[b.rarity]
  const row = el('button', { class: 'arow' })
  const cv = el('canvas')
  cv.width = 96 * DPR
  cv.height = 72 * DPR
  row.appendChild(cv)
  row.appendChild(
    el(
      'div',
      { class: 'ainfo' },
      `<b>${b.name}</b><span class="tag" style="background:${rar.color}">${rar.label}</span>${a.isNew ? '<span class="tag new">NEW</span>' : ''}
       <small>${a.need}번 만에 · ${a.secs.toFixed(1)}초 · ${FROM_LABEL[a.from]}</small>
       <small class="date">${fmtDate(a.at)}</small>`
    )
  )
  row.appendChild(el('span', { class: 'play' }, '▶'))
  void loadReplay(a.id).then((r) => {
    if (!r) return
    const c = cv.getContext('2d')!
    c.scale(DPR, DPR)
    const d = new ReplayDirector(r, a)
    d.render(c, 96, 72, { ...d.still('hit'), view: 150 }, { thumb: true })
  })
  return row
}

function openReplay(id: string): void {
  openId = id
  if (tab !== 'album') setTab('album')
  else renderAlbum()
}

function renderAlbum(): void {
  stopPlayer()
  albumCard.innerHTML = ''
  if (openId && state.album.some((a) => a.id === openId)) return renderPlayer(openId)
  openId = null
  albumCard.appendChild(el('h2', {}, `🎬 생포 기록 <span class="count">${state.album.length}개</span>`))
  albumCard.appendChild(el('p', { class: 'hint' }, '잡은 순간을 슬로모션으로 다시 보고, <b>네컷 사진</b>이나 <b>영상</b>으로 자랑해요. 내 화면 내용은 담기지 않아요 (창 모양만 다시 그려요).'))
  if (!state.album.length) {
    const empty = el('div', { class: 'empty' })
    empty.appendChild(pigeonCanvas(110, 80, 'gray', true, 1.5, { headX: 1, look: -0.4 }))
    empty.appendChild(el('p', {}, '아직 생포 기록이 없어요.<br/>비둘기를 클릭하고 쫓아가서 잡아 보세요!'))
    albumCard.appendChild(empty)
    return
  }
  const list = el('div', { class: 'alist' })
  for (const a of state.album) {
    const row = albumRow(a)
    row.onclick = () => openReplay(a.id)
    list.appendChild(row)
  }
  albumCard.appendChild(list)
}

// ── 리플레이 재생기

let stopPlayer = (): void => undefined

function renderPlayer(id: string): void {
  const a = state.album.find((x) => x.id === id)!
  const b = BREED[a.breed]
  const top = el('div', { class: 'pbar' })
  const back = el('button', { class: 'small-btn' }, '← 목록')
  back.onclick = () => {
    openId = null
    renderAlbum()
  }
  const del = el('button', { class: 'small-btn ghost' }, '지우기')
  del.onclick = async () => {
    stopPlayer()
    await api.deleteReplay(id)
    replays.delete(id)
    openId = null
    toast('생포 기록을 지웠어요')
  }
  top.append(back, el('b', {}, `${b.name} 생포 리플레이`), del)
  albumCard.appendChild(top)

  const wrap = el('div', { class: 'player' })
  const cv = el('canvas')
  const again = el('button', { class: 'again', hidden: '' }, '▶ 다시 보기')
  wrap.append(cv, again)
  albumCard.appendChild(wrap)
  albumCard.appendChild(el('p', { class: 'pmeta' }, `${a.need}번 만에 · ${a.secs.toFixed(1)}초 · ${FROM_LABEL[a.from]} · ${fmtDate(a.at)}`))

  const acts = el('div', { class: 'pacts' })
  const four = el('button', { class: 'btn primary' }, '<span class="ico">📸</span>네컷 만들기<small>사진 한 장으로 자랑</small>')
  const vid = el('button', { class: 'btn' }, '<span class="ico">🎬</span>영상 저장<small>소리까지 MP4로</small>')
  acts.append(four, vid)
  albumCard.appendChild(acts)

  let raf = 0
  let alive = true
  stopPlayer = () => {
    alive = false
    cancelAnimationFrame(raf)
    stopPlayer = () => undefined
  }

  void loadReplay(id).then((r) => {
    if (!alive) return
    if (!r) {
      wrap.replaceChildren(el('p', { class: 'hint' }, '리플레이 파일을 읽지 못했어요.'))
      return
    }
    const d = new ReplayDirector(r, a)
    const size = Math.max(200, Math.round(wrap.clientWidth || 380))
    cv.width = size * DPR
    cv.height = size * DPR
    cv.style.height = `${size}px`
    const c = cv.getContext('2d')!
    const sfx = new Sfx()
    sfx.enabled = state.settings.sound
    const play = (): void => {
      cancelAnimationFrame(raf)
      again.hidden = true
      const t0 = performance.now()
      let prev = 0
      const loop = (): void => {
        if (!alive) return
        const tau = (performance.now() - t0) / 1000
        c.setTransform(DPR, 0, 0, DPR, 0, 0)
        d.render(c, size, size, d.shot(Math.min(tau, d.total)), { hud: true, banner: true })
        d.sounds(prev, tau, sfx)
        prev = tau
        if (tau < d.total) raf = requestAnimationFrame(loop)
        else again.hidden = false
      }
      raf = requestAnimationFrame(loop)
    }
    again.onclick = play
    cv.onclick = play
    play()

    four.onclick = async () => {
      four.setAttribute('disabled', '')
      try {
        showFourCut(await makeFourCut(r, a), b.name)
      } finally {
        four.removeAttribute('disabled')
      }
    }
    vid.onclick = async () => {
      vid.setAttribute('disabled', '')
      const label = vid.innerHTML
      await api.setRecording(true)
      try {
        const out = await recordVideo(r, a, {
          sound: state.settings.sound,
          onProgress: (k) => (vid.innerHTML = `<span class="ico">⏺</span>영상 만드는 중<small>${Math.round(k * 100)}%</small>`)
        })
        vid.innerHTML = label
        const res = await api.saveVideo(out.data, out.ext, `비둘기생포-${b.name.replace(/\s/g, '')}`)
        if (res === 'saved') toast(`영상을 저장했어요 (${out.ext.toUpperCase()}) 🎬`)
      } catch (err) {
        console.error(err)
        toast('영상을 만들지 못했어요')
      } finally {
        await api.setRecording(false)
        vid.innerHTML = label
        vid.removeAttribute('disabled')
      }
    }
  })
}

function showFourCut(url: string, name: string): void {
  const o = el('div', { class: 'modal' })
  const box = el('div', { class: 'box' })
  const img = el('img', { src: url, alt: '비둘기 네컷' })
  const btns = el('div', { class: 'btns' })
  const save = el('button', { class: 'btn primary' }, '💾 저장하고 복사')
  const close = el('button', { class: 'btn' }, '닫기')
  save.onclick = async () => {
    const r = await api.saveImage(url, `비둘기네컷-${name.replace(/\s/g, '')}`)
    if (r === 'saved') toast('네컷을 저장하고 클립보드에도 복사했어요 📸')
    else if (r === 'copied') toast('클립보드에 복사했어요 — 붙여넣기 하세요')
    if (r !== 'cancel') o.remove()
  }
  close.onclick = () => o.remove()
  o.onclick = (e) => {
    if (e.target === o) o.remove()
  }
  btns.append(save, close)
  box.append(img, btns)
  o.appendChild(box)
  document.body.appendChild(o)
}

// ───────── 설정 ─────────

const setCard = el('section', { class: 'card' })
function row(label: string, sub: string, control: HTMLElement): HTMLElement {
  const r = el('div', { class: 'row' })
  r.appendChild(el('label', {}, `${label}${sub ? `<small>${sub}</small>` : ''}`))
  r.appendChild(control)
  return r
}
function toggle(key: keyof Settings): HTMLElement {
  const l = el('label', { class: 'switch' })
  const i = el('input', { type: 'checkbox' })
  i.checked = !!state.settings[key]
  i.onchange = () => void api.setSettings({ [key]: i.checked } as Partial<Settings>)
  l.append(i, el('span'))
  return l
}
function renderSettings(): void {
  const s = state.settings
  setCard.innerHTML = '<h2>⚙️ 설정</h2>'
  const rows = el('div', { class: 'rows' })

  const sel = el('select')
  for (const c of IDLE_CHOICES) {
    const o = el('option', { value: String(c.sec) }, c.label)
    if (c.sec === s.idleSeconds) o.setAttribute('selected', '')
    sel.appendChild(o)
  }
  if (!IDLE_CHOICES.some((c) => c.sec === s.idleSeconds)) sel.appendChild(el('option', { value: String(s.idleSeconds), selected: '' }, `${s.idleSeconds}초`))
  sel.onchange = () => void api.setSettings({ idleSeconds: Number(sel.value) })
  rows.appendChild(row('자리 비움 시간', '이만큼 마우스·키보드를 안 쓰면 날아와요', sel))

  const rg = el('div', { class: 'range' })
  const inp = el('input', { type: 'range', min: '1', max: '12', step: '1', value: String(s.maxPigeons) })
  const out = el('output', {}, `${s.maxPigeons}마리`)
  inp.oninput = () => (out.textContent = `${inp.value}마리`)
  inp.onchange = () => void api.setSettings({ maxPigeons: Number(inp.value) })
  rg.append(inp, out)
  rows.appendChild(row('최대 비둘기 수', '한 화면에 동시에', rg))

  const seg = el('div', { class: 'seg' })
  for (const c of SIZE_CHOICES) {
    const b = el('button', { class: Math.abs(c.v - s.size) < 0.01 ? 'on' : '' }, c.label)
    b.onclick = () => void api.setSettings({ size: c.v })
    seg.appendChild(b)
  }
  rows.appendChild(row('비둘기 크기', '', seg))
  rows.appendChild(row('효과음', '구구·푸드덕 소리', toggle('sound')))
  rows.appendChild(row('말풍선', '비둘기가 가끔 한마디 해요', toggle('bubbles')))
  rows.appendChild(row('전체화면일 땐 오지 않기', '영상·발표·게임 중 방해 금지', toggle('skipFullscreen')))
  rows.appendChild(row('로그인할 때 자동 실행', '', toggle('openAtLogin')))

  const pz = el('div', { class: 'seg' })
  if (live.paused) {
    const b = el('button', { class: 'on' }, '다시 시작')
    b.onclick = () => void api.setSettings({ pausedUntil: 0 })
    pz.appendChild(b)
  } else {
    for (const [label, min] of [
      ['30분', 30],
      ['1시간', 60],
      ['3시간', 180]
    ] as [string, number][]) {
      const b = el('button', {}, label)
      b.onclick = () => void api.setSettings({ pausedUntil: Date.now() + min * 60_000 })
      pz.appendChild(b)
    }
  }
  rows.appendChild(row('잠시 쉬기', '회의·발표 중엔 잠깐 꺼두세요', pz))
  setCard.appendChild(rows)
}

const setFooter = el('footer')
function renderSetFooter(): void {
  setFooter.textContent = `비둘기 모니터 v${version}`
}

// ───────── 처음 실행 안내 ─────────

function onboarding(): void {
  const o = el('div', { class: 'onboard' })
  const box = el('div', { class: 'box' })
  box.appendChild(pigeonCanvas(120, 86, 'gray', true, 1.7, { headX: 1 }))
  box.appendChild(el('h3', {}, '비둘기 모니터에 오신 걸 환영해요'))
  box.appendChild(
    el(
      'ol',
      {},
      [
        '자리를 비우면 비둘기가 날아와 창 위나 화면 아래에 앉아요.',
        '마우스를 휙 휘두르면 놀라서 날아가요.',
        '비둘기를 클릭하면 날아올라요. 쫓아가서 정해진 횟수만큼 맞히면 생포! 밥 먹을 때가 기회예요.',
        '잡은 순간은 <b>생포 기록</b>에서 다시 보고 네컷·영상으로 자랑할 수 있어요.',
        `${api.platform === 'darwin' ? '메뉴 막대' : '작업 표시줄 트레이'}의 비둘기 아이콘에서 언제든 열 수 있어요.`
      ]
        .map((t) => `<li><span>${t}</span></li>`)
        .join('')
    )
  )
  const btns = el('div', { class: 'btns' })
  const now = el('button', { class: 'btn primary' }, '🕊 지금 불러보기')
  const ok = el('button', { class: 'btn' }, '시작하기')
  const close = (): void => {
    o.remove()
    void api.setOnboarded()
  }
  now.onclick = () => {
    close()
    void api.summon()
  }
  ok.onclick = close
  btns.append(now, ok)
  box.appendChild(btns)
  o.appendChild(box)
  document.body.appendChild(o)
}

// ───────── 시작 ─────────

function renderAll(): void {
  renderTabs()
  renderStatus()
  renderRecent()
  renderHomeFooter()
  renderDex()
  renderSettings()
  renderSetFooter()
}

async function init(): Promise<void> {
  ;[state, live, version] = await Promise.all([api.getState(), api.getLive(), api.version()])
  app.appendChild(el('div', { class: 'drag' }))
  const head = el('header', { class: 'hero' })
  head.appendChild(heroPigeon())
  head.appendChild(el('div', {}, '<h1>비둘기 모니터</h1><p>자리를 비우면 내 화면에 비둘기가 날아와요</p>'))
  app.appendChild(head)
  app.appendChild(tabBar)
  const main = el('main')
  views.home.append(statusCard, actions, tip, recentCard, homeFooter)
  views.dex.append(dexCard)
  views.album.append(albumCard)
  views.settings.append(setCard, setFooter)
  main.append(...Object.values(views))
  app.appendChild(main)
  renderAll()
  // 자동 테스트: ?tab=dex 처럼 열 탭을 정할 수 있다
  const want = new URLSearchParams(location.search).get('tab') as Tab | null
  setTab(want && want in views ? want : 'home')
  if (!state.onboarded) onboarding()

  api.onState((s) => {
    const caughtChanged = JSON.stringify(s.caught) !== JSON.stringify(state.caught)
    const settingsChanged = JSON.stringify(s.settings) !== JSON.stringify(state.settings)
    const albumChanged = JSON.stringify(s.album) !== JSON.stringify(state.album)
    state = s
    renderStatus()
    if (caughtChanged) renderDex()
    if (settingsChanged) renderSettings()
    if (albumChanged) {
      renderTabs()
      renderRecent()
      // 보고 있는 리플레이는 그대로 둔다
      if (tab === 'album' && !(openId && s.album.some((a) => a.id === openId))) renderAlbum()
    }
    renderHomeFooter()
  })
  api.onLive((l) => {
    const pausedChanged = l.paused !== live.paused
    live = l
    renderStatus()
    if (pausedChanged) renderSettings()
  })
}

void document.fonts.load("12px 'Galmuri11'").finally(() => void init())
