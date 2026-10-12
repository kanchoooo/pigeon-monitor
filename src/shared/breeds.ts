// 비둘기 품종 — 색·무늬·희귀도·도감 설명

export type BreedId =
  | 'gray'
  | 'checker'
  | 'red'
  | 'black'
  | 'chubby'
  | 'white'
  | 'fantail'
  | 'shades'
  | 'crowned'
  | 'golden'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** hits: 생포할 때 더 맞혀야 하는 횟수 (희귀할수록 많고, 조금 더 빨리 난다) */
export const RARITY: Record<Rarity, { label: string; color: string; hits: number }> = {
  common: { label: '흔함', color: '#8a94a6', hits: 0 },
  uncommon: { label: '보통', color: '#2f9e64', hits: 0 },
  rare: { label: '희귀', color: '#2f74e0', hits: 1 },
  epic: { label: '영웅', color: '#9b4fe3', hits: 2 },
  legendary: { label: '전설', color: '#e8930c', hits: 3 }
}

/** 그리기용 색·모양 */
export interface Look {
  /** 전체 크기 */
  scale: number
  /** 몸통 통통함 */
  fat: number
  line: string
  head: string
  neckA: string
  neckB: string
  body: string
  belly: string
  wing: string
  bar: string
  tip: string
  tail: string
  band: string
  eye: string
  beak: string
  cere: string
  feet: string
  pattern: 'bar' | 'checker' | 'plain' | 'pied'
  tailType: 'normal' | 'fan'
  crest?: 'crown'
  glasses?: boolean
  shine?: boolean
}

export interface Breed {
  id: BreedId
  name: string
  rarity: Rarity
  /** 등장 가중치 */
  weight: number
  desc: string
  look: Look
}

const base: Look = {
  scale: 1,
  fat: 1,
  line: '#2b2f3a',
  head: '#8b93a6',
  neckA: '#3f9f74',
  neckB: '#8b5aa8',
  body: '#9aa3b6',
  belly: '#b2b9c8',
  wing: '#b3bbcb',
  bar: '#2c3039',
  tip: '#5b6170',
  tail: '#8d96a8',
  band: '#2a2e38',
  eye: '#f28a1c',
  beak: '#3a3d46',
  cere: '#f4f2ea',
  feet: '#e2707c',
  pattern: 'bar',
  tailType: 'normal'
}

export const BREEDS: Breed[] = [
  {
    id: 'gray',
    name: '회색 비둘기',
    rarity: 'common',
    weight: 40,
    desc: '광장 어디에나 있는 기본 비둘기. 당신이 일하는 척하는지 감시한다.',
    look: { ...base }
  },
  {
    id: 'checker',
    name: '체크무늬 비둘기',
    rarity: 'common',
    weight: 24,
    desc: '날개에 체크무늬가 있다. 스스로 패셔니스타라고 생각한다.',
    look: { ...base, wing: '#a3abbc', bar: '#353a46', pattern: 'checker', body: '#929bae' }
  },
  {
    id: 'red',
    name: '갈색 비둘기',
    rarity: 'uncommon',
    weight: 10,
    desc: '따뜻한 커피색 깃털. 카페 앞에서 자주 발견된다.',
    look: {
      ...base,
      line: '#3a2a24',
      head: '#b98d74',
      neckA: '#c0704a',
      neckB: '#9a5a7a',
      body: '#c9a690',
      belly: '#dcc0ac',
      wing: '#d8bba7',
      bar: '#8a3a26',
      tip: '#a77b64',
      tail: '#c5a28c',
      band: '#7d3b2a',
      eye: '#f0a020'
    }
  },
  {
    id: 'black',
    name: '흑둘기',
    rarity: 'uncommon',
    weight: 8,
    desc: '까마귀인 척하지만 구구거려서 바로 들킨다.',
    look: {
      ...base,
      line: '#121318',
      head: '#3a3e4a',
      neckA: '#2fb87c',
      neckB: '#9b4fd0',
      body: '#3b3f4b',
      belly: '#4a4f5c',
      wing: '#454a57',
      bar: '#1b1d23',
      tip: '#262930',
      tail: '#363a45',
      band: '#16181d',
      eye: '#ff8a1a',
      cere: '#e9e6dc'
    }
  },
  {
    id: 'chubby',
    name: '닭둘기',
    rarity: 'uncommon',
    weight: 9,
    desc: '너무 많이 먹어서 날기 귀찮아한다. 모이를 주면 제일 먼저 온다.',
    look: { ...base, scale: 1.18, fat: 1.32, body: '#a0a8ba', belly: '#bcc2d0' }
  },
  {
    id: 'white',
    name: '하얀 비둘기',
    rarity: 'rare',
    weight: 4,
    desc: '평화의 상징. 결혼식장에서 탈출했다는 소문이 있다.',
    look: {
      ...base,
      line: '#7d8090',
      head: '#fbfbf8',
      neckA: '#f3f3ef',
      neckB: '#eceae6',
      body: '#f7f7f3',
      belly: '#ffffff',
      wing: '#fdfdfa',
      bar: '#e3e3dd',
      tip: '#e8e8e2',
      tail: '#f4f4f0',
      band: '#e6e6e0',
      eye: '#5a2e14',
      beak: '#e7b1a0',
      cere: '#ffffff',
      feet: '#ef8a8e',
      pattern: 'plain'
    }
  },
  {
    id: 'fantail',
    name: '공작 비둘기',
    rarity: 'rare',
    weight: 3,
    desc: '꼬리를 펼치면 자존감도 같이 펼쳐진다.',
    look: {
      ...base,
      line: '#7a7d8c',
      head: '#fbfbf8',
      neckA: '#f1f1ec',
      neckB: '#eae8e3',
      body: '#f6f6f2',
      belly: '#ffffff',
      wing: '#fbfbf7',
      bar: '#e2e2dc',
      tip: '#e9e9e3',
      tail: '#f9f9f5',
      band: '#ecece6',
      eye: '#6b3010',
      beak: '#e4a998',
      cere: '#ffffff',
      feet: '#ef8a8e',
      pattern: 'plain',
      tailType: 'fan'
    }
  },
  {
    id: 'shades',
    name: '선글라스 비둘기',
    rarity: 'rare',
    weight: 2.2,
    desc: '모니터 블루라이트를 차단하는 중. 쓸데없이 힙하다.',
    look: { ...base, head: '#7f879a', neckA: '#33a9a0', neckB: '#a052c0', glasses: true }
  },
  {
    id: 'crowned',
    name: '왕관 비둘기',
    rarity: 'epic',
    weight: 0.8,
    desc: '열대 섬에서 날아온 비둘기계의 왕족. 머리 장식을 매일 손질한다.',
    look: {
      ...base,
      scale: 1.12,
      line: '#283350',
      head: '#7891c4',
      neckA: '#7891c4',
      neckB: '#6d86ba',
      body: '#6f88bc',
      belly: '#8a4c6c',
      wing: '#87a0d0',
      bar: '#f2f4fb',
      tip: '#4f669a',
      tail: '#6178ab',
      band: '#3d5080',
      eye: '#d9262c',
      beak: '#3a3f55',
      cere: '#6f88bc',
      feet: '#c9506a',
      crest: 'crown'
    }
  },
  {
    id: 'golden',
    name: '황금 비둘기',
    rarity: 'legendary',
    weight: 0.25,
    desc: '본 사람은 그날 칼퇴한다는 전설이 있다.',
    look: {
      ...base,
      line: '#5e3f05',
      head: '#e3a92c',
      neckA: '#ffe07a',
      neckB: '#d98f17',
      body: '#e2a52e',
      belly: '#f6cf62',
      wing: '#f0c04e',
      bar: '#9c6206',
      tip: '#c98a14',
      tail: '#d99c26',
      band: '#94600a',
      eye: '#c1121f',
      beak: '#7a4c06',
      cere: '#fff0b8',
      feet: '#ff8a66',
      shine: true
    }
  }
]

export const BREED: Record<BreedId, Breed> = Object.fromEntries(BREEDS.map((b) => [b.id, b])) as Record<BreedId, Breed>

/** 가중치 랜덤. boost 로 특정 품종 확률을 올린다 (모이를 주면 닭둘기 ×3 등) */
export function pickBreed(boost: Partial<Record<BreedId, number>> = {}): Breed {
  const ws = BREEDS.map((b) => b.weight * (boost[b.id] ?? 1))
  let r = Math.random() * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < BREEDS.length; i++) {
    r -= ws[i]
    if (r <= 0) return BREEDS[i]
  }
  return BREEDS[0]
}
