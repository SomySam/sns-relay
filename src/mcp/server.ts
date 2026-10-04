import { McpServer } from '@modelcontextprotocol/server'
import { VERSION } from '../core/version.js'
import { registerPrompt } from './prompt.js'
import { registerNaverTools } from './tools-naver.js'
import { registerDraftTools } from './tools-drafts.js'
import { registerPublishTools } from './tools-publish.js'
import { registerReadTools } from './tools-read.js'

export interface ServerOptions {
  /** 작업 폴더 (config.json · .env · work/) */
  root: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  /** 파일을 기본 앱으로 연다(naver_export). 기본: 운영체제 기본 앱. 테스트에서 바꿔 넣는다. */
  openFile?: (path: string) => Promise<void>
}

export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'sns-relay', version: VERSION })
  registerReadTools(server, opts)
  registerDraftTools(server, opts)
  registerPublishTools(server, opts)
  registerNaverTools(server, opts)
  registerPrompt(server, opts)
  return server
}
