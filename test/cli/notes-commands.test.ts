import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/program.js'
import { initWorkspace, loadConfig } from '../../src/core/config.js'
import { installMockAgent, makeIo, makeTempDir } from '../helpers.js'
import { fakeJpeg } from '../jpeg-helpers.js'

let root: string
beforeEach(async () => {
  root = makeTempDir()
  await initWorkspace(root)
  writeFileSync(join(root, 'notes.txt'), '오후 세 시 창가 자리.')
})

describe('new --image 여러 번', () => {
  it('사진 2장을 올리고 "사진 2장 올림" 을 낸다', async () => {
    const { agent, restore } = installMockAgent()
    try {
      const config = await loadConfig(root)
      writeFileSync(join(root, 'config.json'), JSON.stringify({ ...config, imageHost: 'cloudinary' }, null, 2))
      writeFileSync(join(root, '.env'), 'CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=123456\nCLOUDINARY_API_SECRET=CLSECRET999\n')
      writeFileSync(join(root, 'a.jpg'), Buffer.from(fakeJpeg(1200, 900)))
      writeFileSync(join(root, 'b.jpg'), Buffer.from(fakeJpeg(1200, 900)))
      for (const n of [1, 2])
        agent
          .get('https://api.cloudinary.com')
          .intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })
          .reply(200, { public_id: `sns-relay/n-${n}`, version: n, width: 1200, height: 900 }, { headers: { 'content-type': 'application/json' } })
      const t = makeIo(root)
      expect(await runCli(['new', '--title', '두 장', '--text', 'notes.txt', '--image', 'a.jpg', '--image', 'b.jpg'], t.io)).toBe(0)
      expect(t.out.join('\n')).toContain('사진 2장 올림')
    } finally {
      await restore()
    }
  })

  it('주소만 여러 개면 "사진 2장 주소"', async () => {
    const t = makeIo(root)
    expect(await runCli(['new', '--title', '주소 두 장', '--text', 'notes.txt', '--image', 'https://img.test/a.jpg', '--image', 'https://img.test/b.jpg'], t.io)).toBe(0)
    expect(t.out.join('\n')).toContain('사진 2장 주소')
  })
})

describe('new', () => {
  it('글감 파일로 링크 없는 작업을 만든다', async () => {
    const t = makeIo(root)
    expect(await runCli(['new', '--title', '동네 카페', '--text', 'notes.txt'], t.io)).toBe(0)
    const out = t.out.join('\n')
    expect(out).toContain('✔ 동네-카페')
    expect(out).toContain('링크 없음')
  })

  it('글감 파일이 없으면 1', async () => {
    const t = makeIo(root)
    expect(await runCli(['new', '--title', '제목', '--text', 'nope.txt'], t.io)).toBe(1)
  })
})

describe('image', () => {
  it('--article 은 imageHost 가 url 이면 1', async () => {
    const t = makeIo(root)
    await runCli(['new', '--title', '사진 글', '--text', 'notes.txt', '--image', 'https://img.test/a.jpg'], t.io)
    const t2 = makeIo(root)
    expect(await runCli(['image', '사진-글', '--article'], t2.io)).toBe(1)
    expect(t2.err.join('\n')).toContain('imageHost')
  })

  it('옵션을 둘 주면 1', async () => {
    const t = makeIo(root)
    expect(await runCli(['image', 'x', '--url', 'https://img.test/a.jpg', '--article'], t.io)).toBe(1)
  })
})
