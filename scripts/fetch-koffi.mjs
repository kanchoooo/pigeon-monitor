// koffi 네이티브 모듈(.node)을 플랫폼별로 받아 build/koffi/<플랫폼_아키텍처>/koffi.node 에 둔다.
// koffi 3 은 플랫폼별 패키지(@koromix/koffi-*)로 나뉘어 있어서, 이 맥에 설치된 것 하나만으로는
// 다른 아키텍처(애플 실리콘)·윈도우용 앱을 만들 수 없다. 앱에는 extraResources 로 넣는다
// (koffi 가 process.resourcesPath/koffi/<triplet>/koffi.node 를 찾아 읽는다).
// 사용법: node scripts/fetch-koffi.mjs [darwin-x64 darwin-arm64 win32-x64]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const version = JSON.parse(readFileSync('node_modules/koffi/package.json', 'utf8')).version
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['darwin-x64', 'darwin-arm64', 'win32-x64']
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

for (const t of targets) {
  const triplet = t.replace('-', '_')
  const dest = join('build', 'koffi', triplet, 'koffi.node')
  const stamp = join('build', 'koffi', triplet, 'VERSION')
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version) continue
  const tmp = mkdtempSync(join(tmpdir(), 'koffi-'))
  try {
    const name = `@koromix/koffi-${t}@${version}`
    const file = execFileSync(npm, ['pack', name, '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop()
    execFileSync('tar', ['-xzf', file], { cwd: tmp })
    mkdirSync(join('build', 'koffi', triplet), { recursive: true })
    copyFileSync(join(tmp, 'package', triplet, 'koffi.node'), dest)
    execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(stamp)}, ${JSON.stringify(version)})`])
    console.log(`koffi ${version} → ${dest}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
