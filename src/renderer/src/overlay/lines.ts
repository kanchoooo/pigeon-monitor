// 비둘기 말풍선 대사
import type { BreedId } from '@shared/breeds'

export const LINES = {
  idle: [
    '구구',
    '구구구…',
    '구우-',
    '여기 뷰 좋네',
    '모니터 따뜻하다',
    '주인 어디 갔구구?',
    '구구단 외우는 중',
    '오늘 점심 뭐 먹지',
    '여기 와이파이 되나',
    '사장님 몰래 쉬는 중',
    '광장보다 여기가 낫네',
    '이 창 내 자리야',
    '멍…',
    '퇴근하고 싶다 구구',
    '탭 너무 많이 열었네',
    '저장은 했구구?'
  ],
  welcome: ['어 왔어?', '벌써 왔구구?', '자리 비운 사이 접수 완료', '일해라 구구', '우리 신경 쓰지 마', '들켰다!', '조용히… 조용히…'],
  eat: ['냠냠', '맛있구구', '밥이다!!', '더 줘', '역시 이 집이 맛집', '와 모이다', '내 거야!'],
  hit: ['살려줘 구구!', '꾸룩?!', '앗!', '구구구구구!!', '나 맛없어!', '쫓아오지 마!', '왜 이래 구구!'],
  escape: ['메롱 구구~', '못 잡지롱', '어림없구구', '다음에 봐!', '헥헥… 살았다'],
  flee: ['으악!', '튀어!', '꾸룩!', '저리 가!'],
  free: ['고마워 구구!', '자유다!', '또 올게 구구'],
  full: ['배부르다 구구', '잘 먹었습니다', '꺼억'],
  sleep: ['zZ', 'zZZ…']
}

export const SPECIAL: Partial<Record<BreedId, string[]>> = {
  chubby: ['배고프다…', '날기 귀찮다', '모이 없어?'],
  shades: ['블루라이트 차단 중', '눈부셔서 말이야'],
  golden: ['✨반짝✨', '오늘 칼퇴 각'],
  crowned: ['짐이 왔노라', '머리 손질 중'],
  white: ['평화…', '결혼식 가야 하는데'],
  black: ['까악… 아니 구구'],
  fantail: ['꼬리 봤어?', '오늘도 예쁘다 나']
}

export function pickLine(kind: keyof typeof LINES, breed?: BreedId): string {
  const special = breed ? SPECIAL[breed] : undefined
  if (kind === 'idle' && special && Math.random() < 0.4) return special[Math.floor(Math.random() * special.length)]
  const list = LINES[kind]
  return list[Math.floor(Math.random() * list.length)]
}
