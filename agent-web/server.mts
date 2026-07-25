import { createServer } from 'node:http'
import process from 'node:process'
import { createApp } from './app.mjs'
import { createAgentRuntime } from './runtime.mjs'

const HOST = '127.0.0.1'
const PORT = 3_001

async function main(): Promise<void> {
  const runtimeHandle = await createAgentRuntime()
  const status = runtimeHandle.runtime.getStatus()
  const server = createServer(createApp(runtimeHandle.runtime))

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(PORT, HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    runtimeHandle.close()
    throw error
  }

  console.log('FilAgentKey web agent')
  console.log(`  valet key: ${status.valetAddress}`)
  console.log(`  root:      ${status.rootAddress}`)
  console.log(`  AddPieces: ${status.permissions.AddPieces ? '✓' : '✗'}`)
  console.log(`  open:      http://${HOST}:${PORT}`)

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    runtimeHandle.close()
    server.close()
    server.closeAllConnections()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
