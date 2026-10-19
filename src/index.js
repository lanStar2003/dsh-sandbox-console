// dsh host plugin: lets commands start under the Windows workspace-write sandbox when
// dsh runs inside Electron (DSH Desktop).
//
// dsh confines a command by launching its windows-acl runner as
// `[process.execPath, runner.js, …]`. Under DSH Desktop process.execPath is the
// Electron app, a GUI program, so the runner has no console, and the command it
// starts under the restricted token has to create one of its own. Windows refuses
// that: PowerShell exits at once with 0xC0000142 (STATUS_DLL_INIT_FAILED), so every
// pwsh call returns no output. This plugin adds a preload to the runner that gives
// it a hidden console first (see preload.js). The confinement itself is unchanged:
// same token, same grants, same arguments.

import { PRELOAD_URL } from './preload.js'

export const name = 'sandbox-console'

export function apply(ctx) {
  if (!needsConsole()) return
  ctx.inject(['sandbox'], (ctx) => {
    const result = install(ctx.sandbox)
    if (result === 'unsupported') {
      ctx.logger.warn('sandbox-console: this dsh build has no windows-acl runner hook; nothing changed')
      return
    }
    if (result === 'installed') ctx.effect(() => () => uninstall(ctx.sandbox))
  })
}

/** Only an Electron-hosted dsh on Windows starts the runner without a console. */
export function needsConsole(platform = process.platform, versions = process.versions) {
  return platform === 'win32' && versions.electron !== undefined
}

/**
 * Point the sandbox's windows-acl runner invocation at the same program and entry,
 * with the preload added. Leaves an override someone else set alone.
 * @returns 'installed', 'kept' (an override exists) or 'unsupported'.
 */
export function install(sandbox) {
  const internals = sandbox?.internals
  if (typeof sandbox?.windowsAclRunnerInvocation !== 'function' || internals === null || typeof internals !== 'object') return 'unsupported'
  if (internals.windowsAclRunnerArgs !== undefined) return 'kept'
  let invocation
  try {
    invocation = sandbox.windowsAclRunnerInvocation()
  } catch {
    return 'unsupported'
  }
  if (!Array.isArray(invocation) || invocation.length < 2) return 'unsupported'
  const [program, ...rest] = invocation
  internals.windowsAclRunnerArgs = [program, '--import', PRELOAD_URL, ...rest]
  return 'installed'
}

/** Undo {@link install} if the override is still ours. */
export function uninstall(sandbox) {
  const internals = sandbox?.internals
  if (internals?.windowsAclRunnerArgs?.[2] === PRELOAD_URL) delete internals.windowsAclRunnerArgs
}
