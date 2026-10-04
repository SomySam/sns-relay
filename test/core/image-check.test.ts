import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasErrors } from '../../src/core/channels/index.js'
import { checkInstagramImage, checkPostImage, readJpegSize } from '../../src/core/image-check.js'
import { installMockAgent } from '../helpers.js'
import { fakeJpeg } from '../jpeg-helpers.js'

const ORIGIN = 'https://img.test'
let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())
const serve = (path: string, body: Uint8Array | string, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, status = 200) =>
  agent.get(ORIGIN).intercept({ path, method: 'GET' }).reply(status, Buffer.from(body as Uint8Array), { headers })

describe('readJpegSize', () => {
  it('SOF0 에서 가로·세로를 읽는다', () => {
    expect(readJpegSize(fakeJpeg(1376, 768))).toEqual({ width: 1376, height: 768 })
  })
  it('가로나 세로가 0 이면 null', () => {
    expect(readJpegSize(fakeJpeg(0, 0))).toBeNull()
    expect(readJpegSize(fakeJpeg(0, 500))).toBeNull()
  })
  it('JPEG 가 아니면 null', () => {
    expect(readJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})

describe('checkInstagramImage', () => {
  it('조건을 만족하면 문제 없음과 크기 정보', async () => {
    serve('/ok.jpg', fakeJpeg(1376, 768))
    const r = await checkInstagramImage(`${ORIGIN}/ok.jpg`)
    expect(r.problems).toEqual([])
    expect(r).toMatchObject({ width: 1376, height: 768 })
    expect(r.bytes).toBeGreaterThan(0)
  })

  it('0×0 이미지는 크기를 읽지 못해 오류', async () => {
    serve('/zero.jpg', fakeJpeg(0, 0))
    expect(hasErrors((await checkInstagramImage(`${ORIGIN}/zero.jpg`)).problems)).toBe(true)
    serve('/zero2.jpg', fakeJpeg(0, 500))
    expect(hasErrors((await checkInstagramImage(`${ORIGIN}/zero2.jpg`)).problems)).toBe(true)
  })

  it('주소가 없으면 오류', async () => {
    expect((await checkInstagramImage(null)).problems[0].message).toContain('이미지가 필요합니다')
  })

  it('WebP 등 JPEG 가 아니면 오류', async () => {
    serve('/a.webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), { 'content-type': 'image/webp' })
    const r = await checkInstagramImage(`${ORIGIN}/a.webp`)
    expect(r.problems.map((p) => p.message).join()).toContain('JPEG 가 아닙니다')
  })

  it('비율이 범위 밖이면 오류 (너무 긴 가로)', async () => {
    serve('/wide.jpg', fakeJpeg(1400, 600))
    expect(hasErrors((await checkInstagramImage(`${ORIGIN}/wide.jpg`)).problems)).toBe(true)
  })

  it('비율이 범위 밖이면 오류 (너무 긴 세로)', async () => {
    serve('/tall.jpg', fakeJpeg(700, 1000))
    expect(hasErrors((await checkInstagramImage(`${ORIGIN}/tall.jpg`)).problems)).toBe(true)
  })

  it('가로가 1440 을 넘으면 경고만', async () => {
    serve('/big.jpg', fakeJpeg(2000, 1200))
    const r = await checkInstagramImage(`${ORIGIN}/big.jpg`)
    expect(r.problems.map((p) => p.level)).toEqual(['warn'])
  })

  it('content-length 가 8MB 를 넘으면 받지 않고 오류', async () => {
    serve('/huge.jpg', fakeJpeg(1000, 1000), { 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) })
    expect((await checkInstagramImage(`${ORIGIN}/huge.jpg`)).problems[0].message).toContain('8MB')
  })

  it('HTTP 오류면 오류', async () => {
    serve('/gone.jpg', 'nope', {}, 404)
    expect((await checkInstagramImage(`${ORIGIN}/gone.jpg`)).problems[0].message).toContain('HTTP 404')
  })
})

describe('checkPostImage', () => {
  it('JPEG 는 통과', async () => {
    agent.get('https://img.test').intercept({ path: '/a.jpg', method: 'GET' }).reply(200, Buffer.from(fakeJpeg(1200, 900)), { headers: { 'content-type': 'image/jpeg' } })
    expect(await checkPostImage('https://img.test/a.jpg')).toEqual([])
  })
  it('PNG 도 통과', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)])
    agent.get('https://img.test').intercept({ path: '/a.png', method: 'GET' }).reply(200, png, { headers: { 'content-type': 'image/png' } })
    expect(await checkPostImage('https://img.test/a.png')).toEqual([])
  })
  it('WebP 는 오류', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)])
    agent.get('https://img.test').intercept({ path: '/a.webp', method: 'GET' }).reply(200, webp, { headers: { 'content-type': 'image/webp' } })
    const p = await checkPostImage('https://img.test/a.webp')
    expect(p[0].level).toBe('error')
  })
  it('가져오지 못하면 오류', async () => {
    agent.get('https://img.test').intercept({ path: '/x.jpg', method: 'GET' }).reply(404, 'no')
    expect((await checkPostImage('https://img.test/x.jpg'))[0].level).toBe('error')
  })
})
