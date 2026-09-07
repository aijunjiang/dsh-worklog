/**
 * 构建 dsh-worklog 的 client bundle（复用 harness tsdown 管线，产出 lib/client.js）。
 *
 * 步骤：把 src/client 拷进 harness checkout 的 packages/remote/dsh-worklog，
 * 写入临时 tsdown 配置（平台 externals 与 __ModuleLoader__ banner/footer 与宿主一致），
 * 用 harness node_modules 里的 tsdown 构建，产物拷回本包 lib/。
 *
 * 运行：DSH_HARNESS_CHECKOUT=<harness 路径> node scripts/build-gui-client.mjs
 * 默认 checkout = 本机 deepseek-harness 路径（可在脚本顶部修改）。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const checkout = resolve(process.env.DSH_HARNESS_CHECKOUT ?? '/Users/ruitongxue/Documents/MyProject/deepseek-harness')
const hostDir = join(checkout, 'packages', 'remote', 'dsh-worklog')
const tsdownCli = join(checkout, 'node_modules', 'tsdown', 'dist', 'run.mjs')
const bundleId = 'dsh-worklog'

if (!existsSync(tsdownCli)) {
  console.error(`tsdown not found at ${tsdownCli} — point DSH_HARNESS_CHECKOUT at the harness checkout`)
  process.exit(1)
}

// -- 1. host the client source inside the harness workspace ----------------
rmSync(hostDir, { recursive: true, force: true })
mkdirSync(join(hostDir, 'src'), { recursive: true })
cpSync(join(root, 'src', 'client'), join(hostDir, 'src', 'client'), { recursive: true })

// -- 2. the client-only tsdown config --------------------------------------
writeFileSync(join(hostDir, 'tsdown.config.ts'), `/**
 * TEMPORARY build host config (created by dsh-worklog/scripts/build-gui-client.mjs).
 */
import { defineConfig } from 'tsdown'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from '../../client/web/src/platform.ts'

const id = ${JSON.stringify(bundleId)}
const externals = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS])

export default defineConfig({
  name: \`\${id}/client\`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => externals.has(specifier),
    alwaysBundle: (specifier: string) => !externals.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: \`window.__ModuleLoader__.load({ id: \${JSON.stringify(id)}, factory: (require) => {\`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
`)

// -- 3. build ---------------------------------------------------------------
try {
  execFileSync(process.execPath, [tsdownCli], { cwd: hostDir, stdio: 'inherit' })
} catch (error) {
  rmSync(hostDir, { recursive: true, force: true })
  console.error('tsdown failed — see the build output above')
  process.exit(1)
}

// -- 4. copy artifacts back --------------------------------------------------
const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })
for (const file of ['client.js', 'client.js.map']) {
  const built = join(hostDir, 'lib', file)
  if (!existsSync(built)) {
    rmSync(hostDir, { recursive: true, force: true })
    console.error(`expected artifact missing: ${built}`)
    process.exit(1)
  }
  copyFileSync(built, join(libDir, file))
}

// -- 5. clean up -------------------------------------------------------------
rmSync(hostDir, { recursive: true, force: true })
const kb = (f) => `${(readFileSync(join(libDir, f)).byteLength / 1024).toFixed(1)} kB`
console.log(`dsh-worklog client bundle rebuilt: lib/client.js (${kb('client.js')}), lib/client.js.map (${kb('client.js.map')})`)
