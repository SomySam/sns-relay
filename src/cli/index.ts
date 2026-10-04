#!/usr/bin/env node
import { runCli } from './program.js'
import { applySecretInput } from './secret-input.js'

/** 입력한 글자를 화면에 되풀이하지 않고 한 줄을 읽는다. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stderr.write(prompt)
    const state = { value: '' }
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      stdin.off('data', onData)
      stdin.off('end', onEnd)
      stdin.off('close', onEnd)
      try {
        stdin.setRawMode(false)
      } finally {
        stdin.pause()
        process.stderr.write('\n')
      }
      if (err) reject(err)
      else resolve(state.value)
    }
    const onData = (chunk: string) => {
      const r = applySecretInput(state, chunk)
      if (r === 'enter') finish()
      else if (r === 'cancel') finish(new Error('입력을 취소했습니다.'))
    }
    const onEnd = () => finish(new Error('입력이 끝났습니다.'))
    try {
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding('utf8')
      stdin.on('data', onData)
      stdin.on('end', onEnd)
      stdin.on('close', onEnd)
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

process.exitCode = await runCli(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + '\n'),
  err: (s) => process.stderr.write(s + '\n'),
  cwd: process.cwd(),
  env: process.env,
  readSecret: process.stdin.isTTY ? readSecret : undefined,
})
