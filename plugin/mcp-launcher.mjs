#!/usr/bin/env node
// Claude Code 플러그인이 MCP 서버를 띄울 때 쓰는 실행기.
// 플러그인 설치는 빌드를 하지 않으므로, 설치된 sns-relay(저장소 받기 → npm install → npm install -g .)를 찾아 `mcp` 로 실행한다.
// Windows 에서 npm 전역 명령은 .cmd 라 바로 실행할 수 없어서 node 로 이 파일을 띄운다.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI = ['sns-relay', 'dist', 'cli', 'index.js']

function findCli() {
  // npm 출력에 기대지 않고 먼저 전역 prefix 후보(npm_config_prefix, PATH 의 각 폴더와 그 상위)를 직접 확인한다.
  const prefixes = []
  if (process.env.npm_config_prefix) prefixes.push(process.env.npm_config_prefix)
  for (const d of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (!d) continue
    prefixes.push(d, dirname(d))
  }
  for (const p of prefixes) {
    for (const cli of [join(p, 'node_modules', ...CLI), join(p, 'lib', 'node_modules', ...CLI)]) {
      if (existsSync(cli)) return cli
    }
  }
  // 못 찾으면 npm 에 물어본다. npm 은 UUID 같은 경로 조각을 ***로 가리므로 그런 결과는 버린다.
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (root.includes('***')) return null
    const cli = join(root, ...CLI)
    return existsSync(cli) ? cli : null
  } catch {
    return null
  }
}

const cli = findCli()
if (!cli) {
  process.stderr.write('sns-relay 가 설치되어 있지 않습니다. README 의 설치(저장소 받기 → npm install → npm install -g .)를 먼저 하세요.\n')
  process.exit(1)
}
// 이 파일에 준 인자를 그대로 넘긴다(보통 "mcp"). stdout 은 MCP 전용이라 여기서 아무것도 쓰지 않는다.
process.argv = [process.argv[0], cli, ...process.argv.slice(2)]
await import(pathToFileURL(cli).href)
