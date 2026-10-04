import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudinarySignature, jpegDeliveryUrl, uploadToCloudinary } from '../../src/core/cloudinary.js'
import { installMockAgent, makeTempDir } from '../helpers.js'
import { fakeJpeg } from '../jpeg-helpers.js'

const ENV = { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '123456', CLOUDINARY_API_SECRET: 'CLSECRET999' }
const NOW = () => new Date('2026-10-01T00:00:00Z')
let agent: MockAgent
let restore: () => Promise<void>
beforeEach(() => ({ agent, restore } = installMockAgent()))
afterEach(() => restore())

describe('cloudinarySignature', () => {
  it('공식 문서 예시와 같다', () => {
    expect(
      cloudinarySignature({ timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' }, 'abcd'),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e')
  })
})

describe('jpegDeliveryUrl', () => {
  it('품질 옵션과 .jpg 로 늘 JPEG 를 받는다', () => {
    expect(jpegDeliveryUrl('demo', '17', 'sns-relay/x-1')).toBe('https://res.cloudinary.com/demo/image/upload/q_85/v17/sns-relay/x-1.jpg')
  })
})

describe('uploadToCloudinary', () => {
  const upload = () => agent.get('https://api.cloudinary.com').intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })

  it('로컬 파일을 올리고 JPEG 주소를 돌려준다', async () => {
    const file = join(makeTempDir(), 'photo.png')
    writeFileSync(file, Buffer.from(fakeJpeg(1200, 900)))
    upload().reply(200, { public_id: 'sns-relay/cafe-notes-1790000000', version: 1790000001, width: 1200, height: 900 }, { headers: { 'content-type': 'application/json' } })
    const r = await uploadToCloudinary(ENV, { file }, 'cafe-notes-1790000000', NOW)
    expect(r).toEqual({ url: 'https://res.cloudinary.com/demo/image/upload/q_85/v1790000001/sns-relay/cafe-notes-1790000000.jpg', width: 1200, height: 900 })
  })

  it('다른 곳의 이미지 주소도 옮겨 올린다', async () => {
    upload().reply(200, { public_id: 'sns-relay/a-1', version: 5, width: 800, height: 800 }, { headers: { 'content-type': 'application/json' } })
    const r = await uploadToCloudinary(ENV, { url: 'https://blog.example.com/og.webp' }, 'a-1', NOW)
    expect(r.url).toBe('https://res.cloudinary.com/demo/image/upload/q_85/v5/sns-relay/a-1.jpg')
  })

  it('거절되면 오류에 secret 이 없다', async () => {
    upload().reply(401, { error: { message: 'Invalid Signature CLSECRET999' } }, { headers: { 'content-type': 'application/json' } })
    const err = await uploadToCloudinary(ENV, { url: 'https://x.test/a.jpg' }, 'a-1', NOW).catch((e: Error) => e)
    expect((err as Error).message).toContain('Cloudinary 업로드 실패')
    expect((err as Error).message).not.toContain('CLSECRET999')
  })

  it('10MB 를 넘는 파일은 올리지 않는다', async () => {
    const file = join(makeTempDir(), 'big.jpg')
    writeFileSync(file, Buffer.alloc(10 * 1024 * 1024 + 1))
    await expect(uploadToCloudinary(ENV, { file }, 'a-1', NOW)).rejects.toThrow('10MB')
  })

  it('키가 없으면 빠진 키 이름을 알려 준다', async () => {
    await expect(uploadToCloudinary({}, { url: 'https://x.test/a.jpg' }, 'a-1', NOW)).rejects.toThrow('CLOUDINARY_CLOUD_NAME')
  })
})

describe('uploadToCloudinary — 로컬 파일 가드와 서명 본문', () => {
  const upload = () => agent.get('https://api.cloudinary.com').intercept({ path: '/v1_1/demo/image/upload', method: 'POST' })

  it('사진이 아닌 확장자는 요청 없이 거절한다', async () => {
    const file = join(makeTempDir(), 'doc.pdf')
    writeFileSync(file, Buffer.from(fakeJpeg(10, 10)))
    await expect(uploadToCloudinary(ENV, { file }, 'a-1', NOW)).rejects.toThrow('사진 파일(JPG·PNG·WebP·GIF·HEIC)만 올릴 수 있습니다')
  })

  it('확장자가 .jpg 여도 내용이 사진이 아니면 거절한다', async () => {
    const file = join(makeTempDir(), 'fake.jpg')
    writeFileSync(file, 'this is not an image at all')
    await expect(uploadToCloudinary(ENV, { file }, 'a-1', NOW)).rejects.toThrow('사진 파일(JPG·PNG·WebP·GIF·HEIC)만 올릴 수 있습니다')
  })

  it('서명 필드를 본문에 싣고 secret 은 싣지 않는다', async () => {
    let captured: unknown
    upload().reply((opts) => {
      captured = opts.body // undici 는 FormData 객체 그대로 넘겨 준다
      return { statusCode: 200, data: { public_id: 'sns-relay/a-abc123-1', version: 3, width: 1, height: 1 }, responseOptions: { headers: { 'content-type': 'application/json' } } }
    })
    await uploadToCloudinary(ENV, { url: 'https://x.test/a.jpg' }, 'a-abc123-1', NOW)
    expect(captured).toBeInstanceOf(FormData)
    const form = captured as FormData
    const timestamp = String(Math.floor(NOW().getTime() / 1000))
    const field = (name: string) => form.get(name)
    expect(field('folder')).toBe('sns-relay')
    expect(field('public_id')).toBe('a-abc123-1')
    expect(field('timestamp')).toBe(timestamp)
    expect(field('overwrite')).toBe('false')
    expect(field('api_key')).toBe('123456')
    expect(field('signature')).toBe(
      cloudinarySignature({ folder: 'sns-relay', overwrite: 'false', public_id: 'a-abc123-1', timestamp }, ENV.CLOUDINARY_API_SECRET),
    )
    expect([...form.values()].map(String).join('|')).not.toContain(ENV.CLOUDINARY_API_SECRET)
  })
})
