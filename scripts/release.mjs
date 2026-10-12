// 새 버전 배포: npm run release              (0.1.0 → 0.1.1)
//              npm run release -- minor     (0.1.0 → 0.2.0)
//              npm run release -- current   (버전 그대로, 첫 배포·재시도용)
//
// 1) 버전 올리고 태그 push  → GitHub Actions 가 윈도우 설치파일을 만들어 초안 릴리스에 올림
// 2) 맥북에서 유니버설 빌드 + Developer ID 서명 + 공증 → 같은 초안 릴리스에 올림
// 3) 윈도우 파일까지 올라오면 릴리스 공개 → 설치된 앱들이 자동 업데이트
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bump = process.argv[2] ?? 'patch'
const PROFILE = process.env.APPLE_KEYCHAIN_PROFILE ?? 'minimi-notary'
const REPO = 'kanchoooo/pigeon-monitor'

// ── 사전 점검 ──
if (process.platform !== 'darwin') throw new Error('맥북에서 실행해 주세요 (맥 서명·공증은 맥에서만 가능)')
if (out('git status --porcelain')) throw new Error('커밋하지 않은 변경이 있어요. 먼저 커밋해 주세요.')
if (!existsSync(join(homedir(), '.minimi-signing', 'DeveloperID_Application.p12'))) {
  throw new Error('서명 인증서(~/.minimi-signing/DeveloperID_Application.p12)가 없어요 (README 참고)')
}
try {
  execSync(`xcrun notarytool history --keychain-profile ${PROFILE}`, { stdio: 'ignore' })
} catch {
  throw new Error(`공증 프로필 "${PROFILE}" 이 없어요. README 의 notarytool store-credentials 를 먼저 실행해 주세요.`)
}
const token = out('gh auth token')

// ── 1. 버전 + 태그 ──
if (bump === 'current') {
  const v = JSON.parse(readFileSync('package.json', 'utf8')).version
  sh('git push')
  sh(`git tag v${v}`)
  sh(`git push origin v${v}`)
} else {
  sh(`npm version ${bump} -m "release v%s"`)
  sh('git push --follow-tags')
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = `v${version}`
// 초안을 먼저 하나 만들어 둔다 (맥·윈도우 업로드가 같은 초안을 쓰도록)
sh(`gh release create ${tag} --repo ${REPO} --draft --verify-tag --title "${tag}" --generate-notes`)

// ── 2. 맥 빌드·서명·공증·업로드 ──
sh('node scripts/build-mac.mjs --publish', { env: { ...process.env, GH_TOKEN: token, APPLE_KEYCHAIN_PROFILE: PROFILE } })

// ── 3. 윈도우 빌드 기다렸다가 공개 ──
console.log('\n윈도우 빌드(GitHub Actions) 기다리는 중…')
const need = ['PigeonMonitor-Setup.exe', 'latest.yml', 'PigeonMonitor-mac.dmg', 'PigeonMonitor-mac.zip', 'latest-mac.yml']
for (let i = 0; ; i++) {
  const assets = JSON.parse(out(`gh release view ${tag} --repo ${REPO} --json assets`)).assets.map((a) => a.name)
  const missing = need.filter((n) => !assets.includes(n))
  if (!missing.length) break
  if (i > 120) throw new Error(`30분이 지나도 안 올라온 파일: ${missing.join(', ')} — Actions 탭을 확인해 주세요`)
  await sleep(15_000)
}
sh(`gh release edit ${tag} --repo ${REPO} --draft=false --latest`)
console.log(`\n🕊 ${tag} 배포 완료!`)
console.log(`  맥:     https://github.com/${REPO}/releases/latest/download/PigeonMonitor-mac.dmg`)
console.log(`  윈도우: https://github.com/${REPO}/releases/latest/download/PigeonMonitor-Setup.exe`)
