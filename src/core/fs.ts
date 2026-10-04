import { rename, rm, stat, writeFile } from 'node:fs/promises'

/** Windows 에서 백신·색인기가 파일을 잠깐 잡고 있을 때 나는 오류 */
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRIES = 5

/** 임시 파일에 쓴 뒤 이름을 바꾼다. 쓰다가 중단돼도 원래 파일이 반쯤 덮이지 않는다. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  // 기존 파일 권한(예: .env 600)을 새 파일에도 준다. 새 파일이면 기본값.
  const mode = await stat(path).then((s) => s.mode & 0o777, () => undefined)
  await writeFile(tmp, content, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (!code || !RETRY_CODES.has(code) || attempt >= RETRIES) {
        await rm(tmp, { force: true })
        throw e
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
}
