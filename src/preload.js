// The module the sandbox runner loads (with `--import`) before its own entry.
//
// It gives the runner a console before the runner starts the confined command: it
// attaches to the parent's console, or else creates one and hides it. The confined
// child then shares that console instead of creating its own, which Windows refuses
// under the restricted, low-integrity token. The runner is started with windowsHide,
// so a console it creates is born hidden; hiding it again covers launchers that do
// not pass SW_HIDE.
//
// koffi is resolved next to the runner entry (process.argv[1]), the same way the
// runner itself loads it. Any failure leaves the runner exactly as it was.

const SOURCE = `
import { createRequire } from 'node:module';
try {
  const koffi = createRequire(process.argv[1])('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const getConsoleWindow = kernel32.func('GetConsoleWindow', 'void *', []);
  const ATTACH_PARENT_PROCESS = 0xffffffff;
  if (!getConsoleWindow() && !kernel32.func('AttachConsole', 'bool', ['uint32'])(ATTACH_PARENT_PROCESS)) {
    if (kernel32.func('AllocConsole', 'bool', [])()) {
      const window = getConsoleWindow();
      if (window) koffi.load('user32.dll').func('ShowWindow', 'bool', ['void *', 'int'])(window, 0);
    }
  }
} catch {}
`

/** `--import` value that runs {@link SOURCE}; a data: URL, so nothing is written to disk. */
export const PRELOAD_URL = `data:text/javascript,${encodeURIComponent(SOURCE)}`
