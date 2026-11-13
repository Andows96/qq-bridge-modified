// QQ 桥接的守护进程（取代 start.bat 里的 :loop / goto 重启循环）。
//
// 为什么要有这个文件：start.bat 用批处理循环守护时，Ctrl+C 会被 cmd.exe 拦截并弹出
// `Terminate batch job (Y/N)?`；即使答 Y，node 被杀后控制权回到 bat，又会撞上
// `pause`（"请按任意键继续"），于是"退出"要点两次键盘。批处理无法摆脱这个行为，
// Node 可以：收到 SIGINT 时先忽略自己在进程组里收到的那一份，转而请子进程优雅退出，
// 再按子进程的退出码决定是退出还是重启。
//
// 分工：
//   - 崩溃（非 0 退出码）→ 等 5 秒重启，保持原来的守护语义；
//   - 干净退出（code 0，即 bridge.js 的 SIGINT/SIGTERM 路径）→ 守护进程一起退出。
//
// 用法：node scripts\bridge-supervisor.mjs
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

const ROOT = path.resolve(import.meta.dirname, '..')
const BRIDGE = path.join(ROOT, 'src', 'bridge.js')
const EXIT_ALREADY_RUNNING = 2
/** 桥接请求「重启」时用的退出码：控制台 /api/restart 走这条路径。 */
const EXIT_RESTART = 75

/**
 * 出错退出前停一下，让人看得见原因。
 *
 * 为什么需要：start.bat 现在把守护进程放进独立窗口后**立刻退出**，所以这个窗口不再由
 * 批处理持有；守护进程一退，窗口就没了。像"已有实例在运行"这种启动失败如果不拦住，
 * 窗口一闪而过、用户什么都看不到。
 *
 * 只在**错误**路径调用：Ctrl+C 的正常退出绝不能走到这里，否则又把"不用确认"改回去了。
 */
function pauseBeforeExit(code) {
  if (!process.stdin.isTTY) return
  console.log(`\n（守护进程退出码 ${code}）按回车键关闭窗口…`)
  try {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('', () => { rl.close(); process.exit(code) })
    // 输入流被关掉（例如窗口正在关闭）时也要能退出去，不能挂死在这里。
    rl.on('close', () => process.exit(code))
  } catch {
    process.exit(code)
  }
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `[${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`
}

/**
 * 收紧 state/ 的 ACL（原来在 start.bat 里做）。
 *
 * 为什么搬到这里：快捷方式现在直接指向 node，不经过 start.bat —— 守护进程必须自己
 * 保证这一步不会被跳过。加固脚本本身**从不阻塞启动**：拿不到权限就打印一条可复制的
 * 命令并以 0 退出，所以这里同步跑、忽略退出码即可。
 */
function hardenStateDir() {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'harden-state-acl.mjs'), '--quiet'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
  } catch {
    // 加固失败不影响启动；脚本自己已经把提示打出来了。
  }
}

let child = null
let shuttingDown = false

// 只接管"用户要求退出"这一种情况。
// Ctrl+C 会把 SIGINT 广播给同进程组的所有进程，bridge.js 自己也会收到并优雅退出；
// 这里忽略自己那份，改为显式请它退出，避免两边同时抢着收尾（存档/释放锁）。
process.on('SIGINT', () => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${stamp()} 收到 Ctrl+C，正在让桥接优雅退出…`)
  if (!child) { process.exit(0); return }
  // Windows 上 SIGTERM 会被映射成 TerminateProcess；但 bridge.js 先收到的是
  // 同一个 Ctrl+C 广播带来的 SIGINT，正常都会走它的 SIGINT 收尾路径。
  try { child.kill('SIGTERM') } catch {}
})

process.on('SIGTERM', () => {
  shuttingDown = true
  try { child?.kill('SIGTERM') } catch {}
})

/** 5 秒后重启桥接（如果用户已经按了 Ctrl+C，就直接退出）。 */
function scheduleRestart() {
  setTimeout(() => {
    if (shuttingDown) process.exit(0)
    // 让行边界清晰：重启前把上一次的输出与这一次分开。
    console.log('')
    start()
  }, 5000)
}

function start() {
  child = spawn(process.execPath, [BRIDGE], {
    cwd: ROOT,
    stdio: 'inherit',   // 日志直接进当前窗口，与以前 `node src/bridge.js` 完全一致
    windowsHide: false,
  })
  child.on('error', (error) => {
    console.log(`${stamp()} 无法启动桥接: ${error?.message ?? error}`)
    child = null
    pauseBeforeExit(1)
  })
  child.on('exit', (code, signal) => {
    const exitCode = code === null ? 1 : code
    child = null
    if (shuttingDown) {
      // 用户按了 Ctrl+C：静默退出，不暂停、不重启。
      console.log(`${stamp()} 桥接已退出，守护进程一并退出。`)
      process.exit(exitCode)
    }
    if (exitCode === EXIT_ALREADY_RUNNING) {
      console.log(`${stamp()} bridge already running in another window. Exiting.`)
      pauseBeforeExit(EXIT_ALREADY_RUNNING)
      return
    }
    if (exitCode === EXIT_RESTART) {
      // 控制台「重启桥接」：必须重启，不能落进下面的 code 0「正常收工」分支
      // （以前桥接用 exit(0)，守护进程于是陪着一起退，重启按钮等于把机器人关掉）。
      console.log(`${stamp()} 收到重启请求，5 秒后重启…`)
      scheduleRestart()
      return
    }
    if (exitCode === 0 && signal === null) {
      // 干净退出（非 Ctrl+C，例如桥接自己判定该收工）：不再拉起。
      console.log(`${stamp()} 桥接正常退出，不再重启。`)
      process.exit(0)
    }
    console.log(`${stamp()} 桥接异常退出（code ${exitCode}${signal ? `, signal ${signal}` : ''}），5 秒后重启…`)
    scheduleRestart()
  })
}

// 启动前兜底：如果 lock 文件指向一个早已不存在的进程，bridge.js 自己也会处理，
// 这里只在明显残留时提示一句，不擅自删除（避免误删正在运行的实例的锁）。
const lock = path.join(ROOT, 'state', 'bridge.lock')
if (existsSync(lock)) {
  console.log(`${stamp()} 注意：state/bridge.lock 已存在，桥接会自行判断是否为残留。`)
}

console.log(`${stamp()} 守护进程已启动（Ctrl+C 直接退出，无需再确认）。`)
hardenStateDir()
start()
