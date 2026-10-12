import { BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * 개발·테스트용 환경변수
 *  PIGEON_IDLE=초            자리비움 기준 시간을 덮어쓴다 (설정보다 우선)
 *  PIGEON_FORCE_AWAY=1       항상 자리비움으로 본다
 *  PIGEON_HEADLESS=1         창을 화면에 띄우지 않고 오프스크린 렌더링 (스크린샷 자동화용)
 *                            → 1440x900 가짜 화면 1개 + 가짜 창(PIGEON_FAKE_WINDOWS=JSON) 사용
 *  PIGEON_SCRIPT=경로.json    오버레이 자동 조작 [{ "at": ms, "summon"|"feed"|"click"|"move"|"shot"|"shoo"|"away": … }]
 *  PIGEON_SHOT_DIR=폴더       PIGEON_SCRIPT 의 shot 저장 위치
 *  PIGEON_LAB=이름           그림 확인용 lab.html#이름 을 띄운다 (PIGEON_SHOT=경로.png 면 캡처 후 종료)
 *  PIGEON_PANEL_SHOT=경로.png 패널 창을 캡처 후 종료
 *  PIGEON_USERDATA=폴더      저장 위치를 바꾼다 (헤드리스는 기본으로 임시 폴더)
 *  PIGEON_SELFTEST=1         창 목록(koffi)을 한 번 읽어 출력하고 종료 (패키징 확인용)
 *  PIGEON_LOG=1              렌더러 콘솔을 터미널로
 *  PIGEON_NO_UPDATE=1        자동 업데이트 끄기
 *  PIGEON_SAVE_DIR=폴더      이미지·영상 저장 대화상자 대신 이 폴더에 바로 저장 (자동 테스트)
 */
export const env = process.env

export function isHeadless(): boolean {
  return env.PIGEON_HEADLESS === '1'
}

export function preloadPath(name: 'panel' | 'overlay'): string {
  return join(__dirname, `../preload/${name}.js`)
}

export function loadRenderer(win: BrowserWindow, page: 'panel' | 'overlay' | 'lab', o: { hash?: string; query?: Record<string, string> } = {}): void {
  const devUrl = env.ELECTRON_RENDERER_URL
  const q = o.query && Object.keys(o.query).length ? '?' + new URLSearchParams(o.query).toString() : ''
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}.html${q}${o.hash ? '#' + o.hash : ''}`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`), { hash: o.hash, query: o.query })
  }
}
