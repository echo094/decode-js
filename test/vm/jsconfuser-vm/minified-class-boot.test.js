import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'

function fixture(name) {
  return fs.readFileSync(
    new URL(`fixtures/minified-class-boot/${name}`, import.meta.url),
    'utf8',
  )
}

function output(script) {
  const window = {}
  vm.runInNewContext(script, { window, atob, btoa }, { timeout: 30000 })
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

const source = fixture('source.js')

test('observes dispatch ordering on a tree without source positions', () => {
  const ast = parse(fixture('encoded-169.js'), { sourceType: 'script' })
  traverse(ast, {
    enter(path) {
      delete path.node.start
      delete path.node.end
    },
  })
  expect(diagnoseMinifiedClassBoot(ast).ok).toBe(true)
})

test.each([169, 170, 171])(
  'observes class/minified boot roles at seed %i',
  (seed) => {
    const encoded = fixture(`encoded-${seed}.js`)
    const record = JSON.parse(fixture(`qualification-${seed}.json`))
    const diagnosed = diagnoseMinifiedClassBoot(encoded)
    expect(diagnosed.ok).toBe(true)
    expect(diagnosed.result.words).toHaveLength(48)
    expect(diagnosed.result.pool).toHaveLength(7)
    expect(diagnosed.result.root).toEqual({ regCount: 7 })
    expect(new Set(Object.values(diagnosed.result.positions)).size).toBe(3)
    expect(new Set(Object.values(diagnosed.result.fields)).size).toBe(3)
    expect(diagnosed.result.dispatch).toEqual({ caseCount: 61, mode: 'switch' })
    expect(diagnosed.result.frame).toMatchObject({
      headerSize: 8,
      frameStart: 1,
      startPc: 0,
    })
    expect(
      new Set([
        ...Object.values(diagnosed.result.fields),
        diagnosed.result.frame.regs,
        diagnosed.result.frame.top,
        diagnosed.result.frame.frame,
      ]).size,
    ).toBe(6)
    expect(output(encoded)).toEqual(output(source))
    expect(record.status).toBe('declined')
    expect(record.diagnostic.message).toContain('Packet A')
  },
)

test('declines damaged boot roles and disconnected dispatch', () => {
  const encoded = fixture('encoded-169.js')
  const detached = encoded.replace('=globalThis;', '={};')
  const root = encoded.replace('{j:0,z:7,C:0}', '{j:0,z:0,C:0}')
  const overwritten = encoded.replace('this.d=a;', 'this.d=a;this.d=0;')
  const labels = encoded.replace('case 0:', 'case 61:')
  const wrongField = encoded.replace('m=a.d[m]', 'm=a.A[m]')
  const unboundDiscriminant = encoded.replace('switch(m)', 'switch(Z)')
  expect(detached).not.toBe(encoded)
  expect(root).not.toBe(encoded)
  expect(overwritten).not.toBe(encoded)
  expect(labels).not.toBe(encoded)
  expect(wrongField).not.toBe(encoded)
  expect(unboundDiscriminant).not.toBe(encoded)
  expect(diagnoseMinifiedClassBoot(detached).ok).toBe(false)
  expect(diagnoseMinifiedClassBoot(root).ok).toBe(false)
  expect(diagnoseMinifiedClassBoot(overwritten).ok).toBe(false)
  expect(diagnoseMinifiedClassBoot(labels).ok).toBe(false)
  expect(diagnoseMinifiedClassBoot(wrongField).ok).toBe(false)
  expect(diagnoseMinifiedClassBoot(unboundDiscriminant).ok).toBe(false)
})

test('declines disconnected minified class frame roles', () => {
  const encoded = fixture('encoded-169.js')
  const controls = [
    ['d[e+6]=u', 'd[e+6]=0', 'Frame role binding is missing'],
    ['d[e+0]=m.C', 'd[e+0]=m.z', 'Frame PC is detached from root start field'],
    ['a.g=e', 'a.g=0', 'VM current frame update'],
    [
      'K(a,f,0,void 0,h,b)',
      'K(a,f,1,void 0,h,b)',
      'Root frame return destination is not zero',
    ],
    [
      'K(a,f,0,void 0,h,b)',
      'K({},f,0,void 0,h,b)',
      'Frame call uses a different VM receiver',
    ],
    [
      ',null,new D({j:0,z:7,C:0},null,[]));',
      ',null,null,new D({j:0,z:7,C:0},null,[]));',
      'Root closure is detached from frame call',
    ],
  ]
  for (const [before, after, diagnostic] of controls) {
    const damaged = encoded.replace(before, after)
    expect(damaged).not.toBe(encoded)
    const result = diagnoseMinifiedClassBoot(damaged)
    expect(result.ok).toBe(false)
    expect(result.diagnostic.message).toBe(diagnostic)
  }
})
