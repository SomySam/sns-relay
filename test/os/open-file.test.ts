import { describe, expect, it } from 'vitest'
import { openCommand } from '../../src/os/open-file.js'

describe('openCommand', () => {
  const path = 'C:/작업 폴더/work/x/naver.md'
  it('win32 는 start 에 빈 창 제목을 두고 경로를 하나의 인자로 넘긴다', () => {
    expect(openCommand(path, 'win32')).toEqual({ cmd: 'cmd', args: ['/c', 'start', '', path] })
  })
  it('darwin 은 open, 그 밖에는 xdg-open', () => {
    expect(openCommand('/a b/naver.md', 'darwin')).toEqual({ cmd: 'open', args: ['/a b/naver.md'] })
    expect(openCommand('/a b/naver.md', 'linux')).toEqual({ cmd: 'xdg-open', args: ['/a b/naver.md'] })
  })
})
