import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { install, needsConsole, uninstall } from '../src/index.js'
import { PRELOAD_URL } from '../src/preload.js'

const fakeSandbox = (invocation = ['C:\\DSH Desktop\\DSH Desktop.exe', 'C:\\app.asar\\runner.js']) => ({
  internals: {},
  windowsAclRunnerInvocation() {
    return this.internals.windowsAclRunnerArgs ?? invocation
  },
})

test('only an Electron host on Windows needs the console', () => {
  assert.equal(needsConsole('win32', { node: '24.17.0', electron: '38.0.0' }), true)
  assert.equal(needsConsole('win32', { node: '24.17.0' }), false)
  assert.equal(needsConsole('darwin', { node: '24.17.0', electron: '38.0.0' }), false)
})

test('the runner keeps its program and entry, with the preload added', () => {
  const sandbox = fakeSandbox()
  assert.equal(install(sandbox), 'installed')
  assert.deepEqual(sandbox.windowsAclRunnerInvocation(), [
    'C:\\DSH Desktop\\DSH Desktop.exe', '--import', PRELOAD_URL, 'C:\\app.asar\\runner.js',
  ])
  assert.equal(install(sandbox), 'kept')
  uninstall(sandbox)
  assert.equal(sandbox.internals.windowsAclRunnerArgs, undefined)
})

test('the source form of the runner keeps its own loader', () => {
  const sandbox = fakeSandbox(['node.exe', '--import', 'data:text/javascript,tsx', 'runner.ts'])
  install(sandbox)
  assert.deepEqual(sandbox.windowsAclRunnerInvocation(), ['node.exe', '--import', PRELOAD_URL, '--import', 'data:text/javascript,tsx', 'runner.ts'])
})

test('an override set by someone else is left alone', () => {
  const sandbox = fakeSandbox()
  sandbox.internals.windowsAclRunnerArgs = ['custom.exe']
  assert.equal(install(sandbox), 'kept')
  uninstall(sandbox)
  assert.deepEqual(sandbox.internals.windowsAclRunnerArgs, ['custom.exe'])
})

test('a dsh build without the hook is not touched', () => {
  assert.equal(install(undefined), 'unsupported')
  assert.equal(install({}), 'unsupported')
  assert.equal(install({ internals: {}, windowsAclRunnerInvocation: () => { throw new Error('no runner') } }), 'unsupported')
})

test('the preload never breaks the program it runs before', () => {
  // argv[1] is not a runner here, so koffi does not resolve; the program must still run.
  const r = spawnSync(process.execPath, ['--import', PRELOAD_URL, '-e', "process.stdout.write('ran')"], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'ran')
})
