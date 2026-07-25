import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { Script } from 'node:vm'
import {
  createApp,
  type AgentWebRuntime,
  type NdjsonLine,
  type StatusPayload,
  type UploadMetadata,
} from './app.mjs'

const IMAGE_HEADERS = {
  'Content-Type': 'application/octet-stream',
  'X-File-Name': 'demo.png',
  'X-Image-Type': 'image/png',
}

class FakeRuntime implements AgentWebRuntime {
  status: StatusPayload = {
    valetAddress: '0x1111111111111111111111111111111111111111',
    rootAddress: '0x2222222222222222222222222222222222222222',
    permissions: { AddPieces: true },
    expiresAt: 2_000_000_000,
  }

  listeners = new Set<() => void>()
  runCount = 0
  runImplementation: (
    bytes: Uint8Array,
    metadata: UploadMetadata,
    emit: (line: NdjsonLine) => void,
  ) => Promise<void> = async (_bytes, _metadata, emit) => {
    emit({ type: 'assistant', text: 'I will store this image.' })
    emit({ type: 'tool_result', text: 'Stored permanently on Filecoin.' })
    emit({
      type: 'transaction',
      text: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    emit({ type: 'piececid', text: 'bafk-test-piece' })
  }

  getStatus(): StatusPayload {
    return {
      ...this.status,
      permissions: { ...this.status.permissions },
    }
  }

  hasAddPieces(): boolean {
    return this.status.permissions.AddPieces
  }

  subscribeRevoked(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async runUpload(
    bytes: Uint8Array,
    metadata: UploadMetadata,
    emit: (line: NdjsonLine) => void,
  ): Promise<void> {
    this.runCount += 1
    await this.runImplementation(bytes, metadata, emit)
  }

  revoke(): void {
    this.status.permissions.AddPieces = false
    for (const listener of this.listeners) listener()
  }
}

interface TestServer {
  baseUrl: string
  server: Server
  close(): Promise<void>
}

async function startServer(runtime: AgentWebRuntime): Promise<TestServer> {
  const server = createServer(createApp(runtime))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_000)
      timer.unref()
    }),
  ])
}

function createSseReader(response: Response): {
  next(): Promise<unknown>
  cancel(): Promise<void>
} {
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''

  const next = async (): Promise<unknown> => {
    for (;;) {
      const boundary = pending.indexOf('\n\n')
      if (boundary !== -1) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n')
        if (data !== '') return JSON.parse(data)
      }

      const result = await reader.read()
      if (result.done) throw new Error('SSE stream ended unexpectedly')
      pending += decoder.decode(result.value, { stream: true })
    }
  }

  return {
    next,
    cancel: async () => {
      await reader.cancel()
    },
  }
}

async function readNdjson(response: Response): Promise<NdjsonLine[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as NdjsonLine)
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('GET / serves the single inline web-agent page', async (context) => {
  const runtime = new FakeRuntime()
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const response = await fetch(`${testServer.baseUrl}/`)
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(html, /accept="image\/\*"/)
  assert.match(html, /new EventSource\("\/status"\)/)
  assert.match(html, /fetch\("\/upload"/)
  assert.match(html, /function startElapsed\(\)/)
  assert.match(html, /window\.setInterval\(tick, 1000\)/)
  assert.match(html, /https:\/\/filecoin-testnet\.blockscout\.com/)
  assert.match(html, /view successful transaction/)
  assert.match(
    html,
    /🔒 my key was revoked — I can no longer store anything\./,
  )
  const inlineScript = html.match(/<script>([\s\S]+)<\/script>/)?.[1]
  assert.ok(inlineScript)
  assert.doesNotThrow(() => new Script(inlineScript))
})

test('GET /status emits initial state, broadcasts revoke, and stays open', async (context) => {
  const runtime = new FakeRuntime()
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const response = await fetch(`${testServer.baseUrl}/status`)
  assert.equal(response.status, 200)
  assert.match(
    response.headers.get('content-type') ?? '',
    /^text\/event-stream/,
  )

  const events = createSseReader(response)
  assert.deepEqual(await withTimeout(events.next(), 'initial SSE state'), runtime.getStatus())
  assert.equal(runtime.listeners.size, 1)

  runtime.revoke()
  assert.deepEqual(await withTimeout(events.next(), 'revocation SSE state'), {
    revoked: true,
  })
  assert.equal(runtime.listeners.size, 1, 'revocation must not close the SSE stream')

  await events.cancel()
  await waitFor(() => runtime.listeners.size === 0, 'SSE cleanup')
})

test('GET /status cannot miss a revoke during its initial handshake', async (context) => {
  const runtime = new FakeRuntime()
  const readStatus = runtime.getStatus.bind(runtime)
  let firstRead = true
  runtime.getStatus = () => {
    if (firstRead) {
      firstRead = false
      runtime.revoke()
    }
    return readStatus()
  }
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const response = await fetch(`${testServer.baseUrl}/status`)
  const events = createSseReader(response)
  const initial = await withTimeout(events.next(), 'race-safe initial SSE state')
  assert.deepEqual(initial, runtime.getStatus())
  assert.deepEqual(await withTimeout(events.next(), 'race-safe revoke state'), {
    revoked: true,
  })

  await events.cancel()
})

test('POST /upload flushes an NDJSON line before the run completes', async (context) => {
  const runtime = new FakeRuntime()
  let releaseRun: (() => void) | undefined
  const runCanFinish = new Promise<void>((resolve) => {
    releaseRun = resolve
  })
  runtime.runImplementation = async (_bytes, metadata, emit) => {
    assert.equal(metadata.filename, 'demo.png')
    assert.equal(metadata.contentType, 'image/png')
    emit({ type: 'assistant', text: 'starting now' })
    await runCanFinish
    emit({ type: 'tool_result', text: 'stored' })
    emit({
      type: 'transaction',
      text: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    emit({ type: 'piececid', text: 'bafk-streamed-piece' })
  }

  const testServer = await startServer(runtime)
  context.after(testServer.close)
  const response = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(128),
  })
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const firstChunk = await withTimeout(reader.read(), 'first NDJSON chunk')
  assert.equal(firstChunk.done, false)
  assert.match(decoder.decode(firstChunk.value), /"type":"assistant","text":"starting now"/)

  releaseRun?.()
  let remainder = ''
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    remainder += decoder.decode(result.value, { stream: true })
  }
  remainder += decoder.decode()
  assert.match(remainder, /"type":"tool_result","text":"stored"/)
  assert.match(remainder, /"type":"transaction"/)
  assert.match(remainder, /"type":"piececid","text":"bafk-streamed-piece"/)
  assert.equal(runtime.runCount, 1)
})

test('revoked upload is refused before the runtime or Claude is called', async (context) => {
  const runtime = new FakeRuntime()
  runtime.status.permissions.AddPieces = false
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const response = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(128),
  })
  const lines = await readNdjson(response)

  assert.equal(response.status, 403)
  assert.deepEqual(lines, [{ type: 'error', text: 'my key has been revoked' }])
  assert.equal(runtime.runCount, 0)
})

test('the raw body boundary accepts 4 MiB and rejects the next byte', async (context) => {
  const runtime = new FakeRuntime()
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const accepted = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(4 * 1024 * 1024),
  })
  assert.equal(accepted.status, 200)
  await accepted.text()
  assert.equal(runtime.runCount, 1)

  const rejected = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(4 * 1024 * 1024 + 1),
  })
  assert.equal(rejected.status, 413)
  assert.equal(await rejected.text(), 'image exceeds the 4 MB limit')
  assert.equal(runtime.runCount, 1)
})

test('wrong media type is rejected and releases the upload slot', async (context) => {
  const runtime = new FakeRuntime()
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const rejected = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'X-Image-Type': 'image/png',
    },
    body: new Uint8Array(128),
  })
  assert.equal(rejected.status, 415)
  assert.equal(await rejected.text(), 'send the image as application/octet-stream')

  const accepted = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(128),
  })
  assert.equal(accepted.status, 200)
  await accepted.text()
  assert.equal(runtime.runCount, 1)
})

test('runtime errors after headers become NDJSON and end cleanly', async (context) => {
  const runtime = new FakeRuntime()
  runtime.runImplementation = async (_bytes, _metadata, emit) => {
    emit({ type: 'status', text: 'started' })
    throw new Error('synthetic runtime failure')
  }
  const testServer = await startServer(runtime)
  context.after(testServer.close)

  const response = await fetch(`${testServer.baseUrl}/upload`, {
    method: 'POST',
    headers: IMAGE_HEADERS,
    body: new Uint8Array(128),
  })
  const lines = await readNdjson(response)

  assert.equal(response.status, 200)
  assert.deepEqual(lines, [
    { type: 'status', text: 'started' },
    { type: 'error', text: 'synthetic runtime failure' },
  ])
})
