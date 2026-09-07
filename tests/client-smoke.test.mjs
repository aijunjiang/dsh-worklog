/**
 * client bundle 无头冒烟：不开浏览器，用 stub 的 __ModuleLoader__ / react / connection
 * 执行 lib/client.js，验证：模块包装正确、导出 inject/apply、apply 注册
 * conversation.view「工作台」且注入 rpc 助手，rpc 能走通 /dsh-worklog 通道并做错误映射。
 * 运行：node --test tests/client-smoke.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const libFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js')

function loadBundle() {
  const code = readFileSync(libFile, 'utf8')
  const windowObj = {}
  const loads = []
  windowObj.__ModuleLoader__ = { load: (spec) => loads.push(spec) }
  // eslint-disable-next-line no-new-func
  new Function('window', code)(windowObj)
  assert.equal(loads.length, 1, 'bundle must call __ModuleLoader__.load once')
  const spec = loads[0]
  assert.equal(spec.id, 'dsh-worklog')
  const reactStub = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    Component: class Component { constructor(p) { this.props = p } setState() {} },
  }
  const requireFn = (id) => {
    if (id === 'react') return reactStub
    throw new Error(`unexpected require: ${id}`)
  }
  return spec.factory(requireFn)
}

function fakeCtx(conn) {
  const regs = {}
  return {
    ctx: {
      get: (name) => (name === 'connection' ? conn : undefined),
      slots: {
        inject: (key, cb) => cb(),
        register: (options, component) => {
          regs[options.name] = { options, component }
          return () => {}
        },
      },
    },
    regs,
  }
}

test('client bundle 导出与「工作台」注册、RPC 走通', async () => {
  const exportsObj = loadBundle()
  assert.deepEqual(exportsObj.inject, ['slots'])
  assert.equal(typeof exportsObj.apply, 'function')

  const okConn = {
    rpc: { call: async (channel, endpoint, payload) => {
      assert.equal(channel, '/dsh-worklog')
      assert.equal(endpoint, 'status')
      assert.deepEqual(payload, {})
      return { ok: true, value: { file: '/x/items.json', sessions: 6 } }
    } },
  }
  const { ctx, regs } = fakeCtx(okConn)
  exportsObj.apply(ctx)
  const reg = regs['conversation.view']
  assert.ok(reg, 'conversation.view registered')
  assert.equal(reg.options.id, 'worklog')
  assert.equal(reg.options.order, 20)
  assert.equal(typeof reg.options.label, 'string')
  assert.equal(reg.options.label, '工作台')
  assert.equal(typeof reg.options.inject, 'function')
  assert.equal(typeof reg.component, 'function')
  assert.ok(regs['settings.plugin.item'], 'settings card registered')

  const injected = reg.options.inject()
  assert.equal(typeof injected.rpc, 'function')
  const value = await injected.rpc('status')
  assert.equal(value.sessions, 6)

  // 错误映射：ok:false → reject
  const badConn = {
    rpc: { call: async () => ({ ok: false, error: { code: 'bad-request', message: 'nope' } }) },
  }
  const { ctx: ctx2, regs: regs2 } = fakeCtx(badConn)
  exportsObj.apply(ctx2)
  const injected2 = regs2['conversation.view'].options.inject()
  await assert.rejects(() => injected2.rpc('month'), /nope/)
})

test('client bundle 无网络通道时 rpc 报错清晰', async () => {
  const exportsObj = loadBundle()
  const { ctx, regs } = fakeCtx(undefined)
  exportsObj.apply(ctx)
  const injected = regs['conversation.view'].options.inject()
  await assert.rejects(() => injected.rpc('status'), /connection/i)
})
