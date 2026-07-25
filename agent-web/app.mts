import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { pageHtml } from './page.mjs'

export interface StatusPayload {
  valetAddress: string
  rootAddress: string
  permissions: {
    AddPieces: boolean
  }
  /** Unix seconds. */
  expiresAt: number
}

export interface NdjsonLine {
  type: string
  text: string
}

export interface UploadMetadata {
  filename: string
  contentType: string
  size: number
}

export interface AgentWebRuntime {
  getStatus(): StatusPayload
  hasAddPieces(): boolean
  subscribeRevoked(listener: () => void): () => void
  runUpload(
    bytes: Uint8Array,
    metadata: UploadMetadata,
    emit: (line: NdjsonLine) => void,
  ): Promise<void>
}

const FOUR_MIB = 4 * 1024 * 1024
const rawImage = express.raw({
  type: 'application/octet-stream',
  limit: '4mb',
})

function setNdjsonHeaders(response: Response, status = 200): void {
  response.status(status)
  response.set({
    'Cache-Control': 'no-cache, no-transform',
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  })
  response.flushHeaders()
}

function writeNdjson(response: Response, line: NdjsonLine): void {
  if (response.destroyed || response.writableEnded) return
  response.write(`${JSON.stringify({ type: line.type, text: line.text })}\n`)
}

function cleanFilename(header: string | undefined): string {
  if (header === undefined || header === '') return 'selected image'
  try {
    return decodeURIComponent(header).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180)
  } catch {
    return 'selected image'
  }
}

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown }
  return (
    candidate.type === 'entity.too.large' ||
    candidate.status === 413 ||
    candidate.statusCode === 413
  )
}

export function createApp(runtime: AgentWebRuntime): Express {
  const app = express()
  let uploadActive = false
  const claimedRequests = new WeakSet<Request>()

  const releaseUpload = (request: Request): void => {
    if (!claimedRequests.has(request)) return
    claimedRequests.delete(request)
    uploadActive = false
  }

  app.disable('x-powered-by')

  app.get('/', (_request, response) => {
    response.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' blob: data:; base-uri 'none'; " +
        "form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    response.type('html').send(pageHtml)
  })

  app.get('/status', (_request, response) => {
    response.status(200)
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    response.flushHeaders()

    const send = (payload: StatusPayload | { revoked: true }): void => {
      if (response.destroyed || response.writableEnded) return
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    let initialSent = false
    let revokedBeforeInitial = false
    const unsubscribe = runtime.subscribeRevoked(() => {
      if (!initialSent) {
        revokedBeforeInitial = true
        return
      }
      send({ revoked: true })
    })
    const initial = runtime.getStatus()
    send(initial)
    initialSent = true
    if (
      revokedBeforeInitial ||
      !initial.permissions.AddPieces ||
      !runtime.hasAddPieces()
    ) {
      send({ revoked: true })
    }

    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, 15_000)
    heartbeat.unref()

    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      clearInterval(heartbeat)
      unsubscribe()
    }
    response.once('close', cleanup)
  })

  const claimUpload = (request: Request, response: Response, next: NextFunction): void => {
    if (!runtime.hasAddPieces()) {
      setNdjsonHeaders(response, 403)
      writeNdjson(response, {
        type: 'error',
        text: 'my key has been revoked',
      })
      response.end()
      return
    }
    if (uploadActive) {
      response.status(409).type('text/plain').send('an upload is already in progress')
      return
    }
    uploadActive = true
    claimedRequests.add(request)
    next()
  }

  app.post('/upload', claimUpload, rawImage, async (request, response) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        response
          .status(415)
          .type('text/plain')
          .send('send the image as application/octet-stream')
        return
      }

      const contentType = request.get('X-Image-Type')?.trim().toLowerCase()
      if (contentType === undefined || !contentType.startsWith('image/')) {
        response.status(415).type('text/plain').send('only image uploads are accepted')
        return
      }

      if (request.body.length === 0) {
        response.status(400).type('text/plain').send('the selected image is empty')
        return
      }
      if (request.body.length < 65) {
        response
          .status(400)
          .type('text/plain')
          .send('the selected image must be at least 65 bytes')
        return
      }
      if (request.body.length > FOUR_MIB) {
        response.status(413).type('text/plain').send('image exceeds the 4 MB limit')
        return
      }

      setNdjsonHeaders(response)
      const emit = (line: NdjsonLine): void => {
        writeNdjson(response, line)
      }

      try {
        await runtime.runUpload(
          request.body,
          {
            filename: cleanFilename(request.get('X-File-Name')),
            contentType,
            size: request.body.length,
          },
          emit,
        )
      } catch (error) {
        emit({
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
        })
      }
      if (!response.destroyed && !response.writableEnded) response.end()
    } finally {
      releaseUpload(request)
    }
  })

  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    releaseUpload(request)
    if (response.headersSent) {
      next(error)
      return
    }
    if (isPayloadTooLarge(error)) {
      response.status(413).type('text/plain').send('image exceeds the 4 MB limit')
      return
    }
    response.status(400).type('text/plain').send('could not read the image upload')
  }
  app.use(errorHandler)

  return app
}
