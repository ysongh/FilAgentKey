import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLockoutShutdown } from './lockout.mjs'

class ExitSignal extends Error {}

test('flag off preserves the verified lockout behavior', () => {
  const reasons = ['SESSION KEY REVOKED ON-CHAIN', 'SESSION KEY EXPIRED']

  for (const reason of reasons) {
    const output: string[] = []
    const errors: string[] = []
    let exitCode: number | undefined
    let sweepCalls = 0
    const lockout = createLockoutShutdown({
      sweep: false,
      sweepSessionBalance: async () => {
        sweepCalls += 1
      },
      exit: (code) => {
        exitCode = code
        throw new ExitSignal()
      },
      log: (message) => output.push(message),
      logError: (message) => errors.push(message),
    })

    assert.throws(() => lockout.shutdown(reason), ExitSignal)
    assert.deepEqual(output, [
      `\n🔒 ${reason} — access lost, shutting down.`,
    ])
    assert.deepEqual(errors, [])
    assert.equal(exitCode, 1)
    assert.equal(sweepCalls, 0)
    assert.equal(lockout.pending(), undefined)
  }
})

test('sweep failure stays one-line, single-shot, and exits', async () => {
  const output: string[] = []
  const errors: string[] = []
  const exitCodes: number[] = []
  let sweepCalls = 0
  const lockout = createLockoutShutdown({
    sweep: true,
    sweepSessionBalance: async () => {
      sweepCalls += 1
      throw new Error('RPC failed\nwith details')
    },
    exit: (code) => {
      exitCodes.push(code)
      throw new ExitSignal()
    },
    log: (message) => output.push(message),
    logError: (message) => errors.push(message),
  })

  const first = lockout.shutdown('SESSION KEY REVOKED ON-CHAIN')
  const duplicate = lockout.shutdown('SESSION KEY EXPIRED')
  assert(first instanceof Promise)
  assert.equal(duplicate, first)
  await assert.rejects(first, ExitSignal)

  assert.deepEqual(output, [
    '\n🔒 SESSION KEY REVOKED ON-CHAIN — access lost, shutting down.',
  ])
  assert.deepEqual(errors, ['sweep failed: RPC failed with details'])
  assert.deepEqual(exitCodes, [1])
  assert.equal(sweepCalls, 1)
})
