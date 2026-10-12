// 맥 유니버설 빌드 + Developer ID 서명 + 공증
// 사용법: node scripts/build-mac.mjs [--publish]   (npm run dist:mac / npm run release 에서 사용)
//
// 서명: ~/.minimi-signing/DeveloperID_Application.p12 (+ p12-password) — 미니미 광장과 같은 Developer ID 인증서
//   빌드 전용 임시 키체인에 넣어서 서명 → 키체인 "허용" 창이 뜨지 않는다.
//   (electron-builder 26 의 CSC_LINK 임시 키체인은 set-key-partition-list 에 p12 비밀번호를 넘기는 버그가 있어 직접 만든다)
// 공증: 키체인 프로필 "minimi-notary" (xcrun notarytool store-credentials 로 한 번 저장)
//
// 키체인 안전 규칙 (다른 앱이 아무도 모르는 암호 창에 걸리지 않게)
//   - 임시 키체인은 검색 목록 맨 뒤(login.keychain-db 뒤)에만 붙이고, 빌드 중에는 잠기지 않게 둔다
//   - 끝나면(성공·실패·Ctrl+C·SIGTERM·예외 모두) 목록에서 빼고 지운다
//   - 끊긴 빌드가 남긴 임시 키체인은 다음 빌드 시작 때 먼저 치운다
//   - 서명 빌드는 한 번에 하나만: ~/.minimi-signing/.build.lock (미니미 광장 등 다른 프로젝트의 서명 빌드와 같이 쓴다)
//   - 기본 키체인·로그인 키체인 암호는 건드리지 않는다
import { execFileSync, execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const dir = process.env.MINIMI_SIGNING_DIR ?? join(homedir(), '.minimi-signing')
const p12 = join(dir, 'DeveloperID_Application.p12')
const pwFile = join(dir, 'p12-password')
const profile = process.env.APPLE_KEYCHAIN_PROFILE ?? 'minimi-notary'
const publish = process.argv.includes('--publish')
const LOCK = join(homedir(), '.minimi-signing', '.build.lock')

if (!existsSync(p12) || !existsSync(pwFile)) {
  throw new Error(`서명 인증서가 없어요: ${p12} (README "맥 서명·공증" 참고)`)
}
let notarize = true
try {
  execSync(`xcrun notarytool history --keychain-profile ${profile}`, { stdio: 'ignore' })
} catch {
  notarize = false
}
if (!notarize && publish) throw new Error(`공증 프로필 "${profile}" 이 없어요. 배포 전에 공증 설정이 필요해요.`)
if (!notarize) console.warn(`⚠ 공증 프로필 "${profile}" 이 없어 서명만 하고 공증은 건너뜁니다.`)

const IDENTITY = 'KWANGJO KIM (GQJXPJX34S)'
// 미니미 광장 빌드와 이름이 겹치지 않게
const keychain = join(dir, 'pigeon-build.keychain-db')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const security = (...args) => execFileSync('/usr/bin/security', args, { encoding: 'utf8' })
const unquote = (l) => l.trim().replace(/^"|"$/g, '')
const userKeychains = () => security('list-keychains', '-d', 'user').split('\n').map(unquote).filter(Boolean)

/** 검색 목록을 바꾼다. 비면 기본 키체인(로그인)만 남긴다 */
function setUserKeychains(list) {
  if (!list.length) list = [unquote(security('default-keychain', '-d', 'user'))]
  security('list-keychains', '-d', 'user', '-s', ...list)
}

/** 목록에서 우리 임시 키체인(과 이미 지워진 키체인 파일)만 뺀다 — 다른 항목은 그대로 둔다 */
function dropFromSearchList({ missingToo = false } = {}) {
  const now = userKeychains()
  const keep = now.filter((k) => k !== keychain && (!missingToo || existsSync(k)))
  if (keep.length !== now.length) {
    for (const k of now.filter((k) => !keep.includes(k))) console.log(`  키체인 검색 목록에서 뺌: ${k}`)
    setUserKeychains(keep)
  }
}

// ───────── 동시 빌드 잠금 ─────────

let lockHeld = false

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

async function acquireLock() {
  mkdirSync(dirname(LOCK), { recursive: true, mode: 0o700 })
  for (let waited = 0; ; waited += 5) {
    try {
      const fd = openSync(LOCK, 'wx', 0o600)
      writeSync(fd, JSON.stringify({ pid: process.pid, project: process.cwd(), startedAt: new Date().toISOString() }))
      closeSync(fd)
      lockHeld = true
      return
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let info = null
    try {
      info = JSON.parse(readFileSync(LOCK, 'utf8'))
    } catch {
      /* 막 만들어지는 중이거나 깨진 파일 */
    }
    let stale = info ? !alive(Number(info.pid)) : false
    if (!info) {
      try {
        stale = Date.now() - statSync(LOCK).mtimeMs > 60_000
      } catch {
        continue // 그 사이에 지워짐
      }
    }
    if (stale) {
      console.warn(`이전에 끊긴 서명 빌드의 잠금을 지웁니다${info ? ` (pid ${info.pid}, ${info.project})` : ''}`)
      try {
        unlinkSync(LOCK)
      } catch {
        /* 다른 쪽이 먼저 지움 */
      }
      continue
    }
    if (waited === 0) {
      console.log(`다른 서명 빌드가 진행 중이에요 (pid ${info?.pid ?? '?'}, ${info?.project ?? '?'}) — 끝나길 기다립니다…`)
    }
    if (waited >= 3600) throw new Error(`한 시간을 기다려도 다른 서명 빌드가 끝나지 않았어요: ${LOCK}`)
    await sleep(5000)
  }
}

// ───────── 정리 (어떻게 끝나든 한 번) ─────────

let child = null
let cleaned = false

function cleanup() {
  if (cleaned) return
  cleaned = true
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM') // electron-builder 와 그 아래 codesign 까지
    } catch {
      /* 이미 끝남 */
    }
  }
  if (lockHeld) {
    try {
      dropFromSearchList()
    } catch (e) {
      console.warn('키체인 검색 목록 복구 실패 — `security list-keychains -d user` 를 확인해 주세요', e)
    }
    try {
      security('delete-keychain', keychain)
    } catch {
      /* 없으면 무시 */
    }
    try {
      unlinkSync(LOCK)
    } catch {
      /* 무시 */
    }
    lockHeld = false
  }
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
for (const [sig, code] of Object.entries(SIGNALS)) {
  process.on(sig, () => {
    console.warn(`\n${sig} — 임시 키체인을 치우고 끝냅니다`)
    cleanup()
    process.exit(code)
  })
}
process.on('uncaughtException', (e) => {
  console.error(e)
  cleanup()
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(e)
  cleanup()
  process.exit(1)
})
process.on('exit', cleanup)

/** 자식 프로세스를 따로 묶어 실행 — 신호가 오면 cleanup() 이 묶음째 끈다 */
function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    child = spawn(cmd, args, { stdio: 'inherit', env, detached: true })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      child = null
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} 실패 (${signal ?? code})`))
    })
  })
}

// ───────── 빌드 ─────────

await acquireLock()

// 끊긴 빌드가 남긴 임시 키체인부터 치운다
dropFromSearchList({ missingToo: true })
try {
  security('delete-keychain', keychain)
} catch {
  /* 없으면 무시 */
}

const kcPass = randomBytes(24).toString('hex')
security('create-keychain', '-p', kcPass, keychain)
// 옵션 없음 = 시간·잠자기로 잠기지 않음 (빌드 중 다른 앱의 키체인 조회가 암호 창에 걸리지 않게)
security('set-keychain-settings', keychain)
security('unlock-keychain', '-p', kcPass, keychain)
security('import', p12, '-k', keychain, '-P', readFileSync(pwFile, 'utf8').trim(), '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild')
security('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', kcPass, keychain)
// electron-builder 가 서명 인증서를 검색 목록에서 찾으므로 넣되, 맨 뒤(로그인 키체인 뒤)에 붙인다
setUserKeychains([...userKeychains().filter((k) => k !== keychain), keychain])

const env = {
  ...process.env,
  CSC_KEYCHAIN: keychain,
  CSC_NAME: IDENTITY,
  ...(notarize ? { APPLE_KEYCHAIN_PROFILE: profile } : {})
}
delete env.CSC_LINK
delete env.CSC_KEY_PASSWORD
if (!notarize) delete env.APPLE_KEYCHAIN_PROFILE
if (publish) env.GH_TOKEN = process.env.GH_TOKEN ?? execSync('gh auth token', { encoding: 'utf8' }).trim()

try {
  await run('node', ['scripts/fetch-koffi.mjs', 'darwin-x64', 'darwin-arm64'])
  await run('npx', ['electron-vite', 'build'])
  await run('npx', ['electron-builder', '--mac', '--universal', '--publish', publish ? 'always' : 'never'], env)
} finally {
  cleanup()
}
