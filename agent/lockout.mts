import process from 'node:process'

const SWEEP_FAIL_SAFE_MS = 120_000

type Exit = (code: number) => never
type Log = (message: string) => void

export interface LockoutOptions {
  sweep: boolean
  sweepSessionBalance: () => Promise<void>
  exit?: Exit
  log?: Log
  logError?: Log
  failSafeMs?: number
}

export interface LockoutShutdown {
  shutdown: (reason: string) => never | Promise<never>
  pending: () => Promise<never> | undefined
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/\s+/g, ' ').trim() || 'unknown error'
}

export function createLockoutShutdown(
  options: LockoutOptions,
): LockoutShutdown {
  const exit = options.exit ?? ((code: number): never => process.exit(code))
  const log = options.log ?? console.log
  const logError = options.logError ?? console.error
  let pendingShutdown: Promise<never> | undefined

  const shutdown = (reason: string): never | Promise<never> => {
    if (!options.sweep) {
      log(`\n🔒 ${reason} — access lost, shutting down.`)
      return exit(1)
    }
    if (pendingShutdown !== undefined) return pendingShutdown

    log(`\n🔒 ${reason} — access lost, shutting down.`)
    pendingShutdown = (async (): Promise<never> => {
      const failSafe = setTimeout(() => {
        logError('sweep failed: sweep timed out')
        exit(1)
      }, options.failSafeMs ?? SWEEP_FAIL_SAFE_MS)

      try {
        await options.sweepSessionBalance()
      } catch (cause) {
        logError(`sweep failed: ${errorMessage(cause)}`)
      } finally {
        clearTimeout(failSafe)
      }
      return exit(1)
    })()
    return pendingShutdown
  }

  return {
    shutdown,
    pending: () => pendingShutdown,
  }
}
