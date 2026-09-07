/**
 * transcript.js 单测：buildNodes 对话节点切片 + hashText 指纹。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNodes, hashText } from '../src/transcript.js'

function um(seq, time, text, kind = 'user') {
  return { type: 'user/message', seq, time, data: { source: { kind }, content: [{ type: 'text', text }] } }
}
function am(seq, time, text) {
  return { type: 'assistant/message', seq, time, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text }] } } }
}
function pm(seq, time, text) {
  // 插件注入的系统消息（应被剔除）
  return { type: 'user/message', seq, time, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text }] } }
}

test('buildNodes：每个真实用户消息为一个节点，助手消息归入其后', () => {
  const evs = [
    pm(0, 1000, '系统提示'),                       // 剔除
    um(1, 2000, '问题A'), am(2, 3000, '回答A'),     // 节点1
    am(3, 4000, '补充A'),                          // 仍属节点1
    um(4, 5000, '问题B'), am(5, 6000, '回答B'),     // 节点2
  ]
  const nodes = buildNodes(evs, 480)
  assert.equal(nodes.length, 2)
  assert.ok(nodes[0].text.includes('问题A') && nodes[0].text.includes('回答A') && nodes[0].text.includes('补充A'))
  assert.ok(nodes[1].text.includes('问题B') && nodes[1].text.includes('回答B'))
  assert.equal(nodes[0].day, nodes[1].day) // 同一天（示例时间都在同一本地日）
})

test('hashText：内容相同指纹一致、内容不同指纹不同', () => {
  assert.equal(hashText('abc'), hashText('abc'))
  assert.notEqual(hashText('abc'), hashText('abd'))
})
