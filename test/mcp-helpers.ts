import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { createServer, type ServerOptions } from '../src/mcp/server.js'

/** 서버와 클라이언트를 메모리로 잇는다. call 은 응답 글·구조화 결과·오류 여부를 돌려준다. */
export async function connect(root: string, opts: Omit<ServerOptions, 'root'> = {}) {
  const server = createServer({ root, ...opts })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { isError: r.isError === true, text, data: r.structuredContent as any }
    },
    close: () => client.close(),
  }
}
