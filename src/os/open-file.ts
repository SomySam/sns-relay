import { spawn } from 'node:child_process'

/** 플랫폼별로 파일을 기본 앱으로 여는 명령. win32 의 빈 인자는 start 의 창 제목 자리이고, 공백이 있는 경로는 Node 가 따옴표로 감싼다. */
export function openCommand(path: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', path] }
  if (platform === 'darwin') return { cmd: 'open', args: [path] }
  return { cmd: 'xdg-open', args: [path] }
}

/** 파일을 기본 앱으로 연다. 화면(stdout)에는 아무것도 쓰지 않는다 — MCP stdio 안전. */
export function openInDefaultApp(path: string): Promise<void> {
  const { cmd, args } = openCommand(path)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
