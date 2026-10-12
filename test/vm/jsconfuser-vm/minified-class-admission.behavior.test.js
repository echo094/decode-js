// Native boundary: this test requires separately retained local fixture data.
import fs from 'node:fs'
import { expect, test } from 'vitest'
import {
  currentExceptionRecovery,
  observeException,
} from './minified-class-behavior-support.js'
const root = new URL('fixtures/minified-class-admission/', import.meta.url)
const source = fs.readFileSync(
  new URL('exception-routes.source.js', root),
  'utf8',
)
const expected = JSON.parse(
  fs.readFileSync(new URL('exception-routes.expected.json', root), 'utf8'),
)
// Required local data fail before native observation when not supplied.
const provenance = JSON.parse(
  fs.readFileSync(new URL('native-qualification.json', root), 'utf8'),
)
expect(provenance.cells).toHaveLength(12)
for (const profile of [
  'baseline',
  'minify',
  'classObfuscation',
  'minifyClassObfuscation',
])
  for (const seed of [172, 173, 174])
    test(`exceptionRoutes/${profile}/${seed}: current output native closure`, () => {
      const cell = provenance.cells.find(
        (cell) => cell.profile === profile && cell.seed === seed,
      )
      expect(cell).toBeDefined()
      expect(cell.encodedFile).toBe(`${profile}-${seed}.encoded.js`)
      const encoded = fs.readFileSync(new URL(cell.encodedFile, root), 'utf8')
      const output = currentExceptionRecovery(encoded)
      expect(observeException(source)).toEqual(expected)
      expect(observeException(encoded)).toEqual(expected)
      expect(observeException(output)).toEqual(expected)
    })
