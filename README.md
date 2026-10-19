# dsh-sandbox-console：修好 DSH Desktop 里沙箱下的 PowerShell

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的插件，只修一个问题：在 DSH Desktop 里，权限是「工作区内修改」（workspace-write 沙箱）时，**每一次 PowerShell 调用都会立刻失败**，没有任何输出，退出码是 `3221225794`（`0xC0000142`，STATUS_DLL_INIT_FAILED）。

## 症状

- 标准模式：`pwsh` 工具返回 `(no output)` 和 `[exit code: 3221225794]`。模型看到退出码，会改用 glob、read 之类的工具绕过去，所以看起来「还能用」，只是很慢、很绕。
- PTC 模式（代码模式）：程序里 `tools.pwsh(...)` 拿到的 `stdout` 是空的。模型通常只打印 stdout，看不到退出码，就会一遍遍重试、猜原因，看起来像「半天没反应」。
- 换成「完全访问」（danger-full-access，不用沙箱）后 PowerShell 正常。

## 原因

dsh 在 Windows 上用一个 runner 进程实现沙箱：runner 用受限令牌（WRITE_RESTRICTED、低完整性）启动要执行的命令。启动 runner 的命令是 `[process.execPath, runner.js, …]`。

- 用 npm 装的 dsh 里，`process.execPath` 是 `node.exe`，它是控制台程序，runner 有控制台，PowerShell 直接共用这个控制台。
- DSH Desktop 里，`process.execPath` 是 Electron 的 `DSH Desktop.exe`，它是 GUI 程序，runner 没有控制台。PowerShell 只能在受限令牌下自己创建控制台，Windows 不允许，进程初始化就失败了。dsh 的沙箱源码里也写了这条限制：受限令牌下需要新控制台的子进程会以 STATUS_DLL_INIT_FAILED 退出。

DSH Desktop 0.12.0 本来想给 Harness 进程配一个隐藏控制台（`windows-hidden-console.mjs`），但打包后它到 `resources/app` 下找 koffi，实际的包在 `app.asar` 里，所以这一步静默失败了。就算成功，GUI 程序的 runner 也不会继承这个控制台。

## 插件做了什么

插件给 runner 多加一个 `--import` 预加载：runner 在启动命令之前，先挂到父进程的控制台上；如果父进程没有控制台，就自己建一个并隐藏。之后 PowerShell 共用这个控制台，正常启动。

- 沙箱本身不变：同一个受限令牌、同样的写入授权、同样的参数。runner 本来就是不受限的进程，控制台由它建，不放宽任何限制。
- 不会弹窗：runner 是以隐藏方式启动的，新建的控制台从一开始就不可见，之后还会再隐藏一次。
- 只在 Windows 上、并且 dsh 跑在 Electron 里（DSH Desktop）时生效，别的环境什么也不改。
- 预加载用 `data:` 网址传入，不往磁盘写任何文件。卸载插件就完全恢复原样。

## 安装

要求 dsh 0.2.0-rc.2 或之后的 0.2.x 版本（DSH Desktop 0.12.0 内置的就是 0.2.0-rc.2）。

每个版本的 tgz 都挂在 [Releases](https://github.com/lanStar2003/dsh-sandbox-console/releases) 页上。当前版本的网址：

```text
https://github.com/lanStar2003/dsh-sandbox-console/releases/download/v0.1.0/dsh-sandbox-console-0.1.0.tgz
```

### 在 DSH Desktop 的界面里装

1. 打开「插件」页，点「添加插件」。
2. 粘贴上面的网址，点「安装」，再点「立即启用」。
3. 完全退出 Desktop 再打开。

### 用 DSH Desktop 自带的 dsh 命令行装

在 PowerShell 里运行（路径按你的安装位置改）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
$env:PATH = "$env:APPDATA\dsh-desktop\harness\.desktop-bin;$env:PATH"
& 'D:\software\DSH Desktop\DSH Desktop.exe' 'D:\software\DSH Desktop\resources\app.asar\node_modules\@deepseek-ai\dsh\lib\bin.js' plugin --profile web add https://github.com/lanStar2003/dsh-sandbox-console/releases/download/v0.1.0/dsh-sandbox-console-0.1.0.tgz
```

一定要设 `DSH_HOME`，否则会装进 `~/.dsh`，Desktop 看不到。装好后完全退出 Desktop 再打开。

## 验证

装好并重启后，新开一个会话（权限保持「工作区内修改」），让模型运行：

```powershell
Write-Output "pwsh-ok $($PSVersionTable.PSVersion)"
```

能看到 `pwsh-ok 5.1…`（装了 PowerShell 7 就是 7.x）就说明修好了。

## 开发

```bash
npm test
```

`dev/` 里有端到端测试用的两个脚本：

- `dev/mock-pwsh.mjs`：模拟模型，让会话跑一条 PowerShell 命令，并把工具结果记到 `dev/.mock-log.jsonl`。
- `dev/electron-web.mjs`：按 DSH Desktop 的方式（Electron 当 node 用、detached、windowsHide）启动 `dsh web`，用来复现没有控制台的情况。

```bash
node dev/mock-pwsh.mjs 8766
node --env-file=<env 文件> dev/electron-web.mjs "D:/software/DSH Desktop/DSH Desktop.exe" <dsh 的 lib/bin.js> 3082
```

env 文件里设 `DSH_HOME`（一个装了本插件的测试用 dsh 主目录）、`DEEPSEEK_BASE_URL=http://127.0.0.1:8766` 和任意 `DEEPSEEK_API_KEY`。

## 发布

改 `package.json` 的版本号，提交到 main，推送 `v<版本>` 标签。CI 跑测试、打包，并把 tgz 挂到对应的 Release 上。
