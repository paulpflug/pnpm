import tape = require('tape')
import promisifyTape from 'tape-promise'
import path = require('path')
import readPkg = require('read-pkg')
import {prepare, testDefaults, addDistTag} from '../utils'
import {installPkgs} from '../../src'

const test = promisifyTape(tape)

test('global installation', async function (t) {
  prepare(t)
  const globalPrefix = path.resolve('..', 'global')
  const opts = testDefaults({global: true, prefix: globalPrefix})
  await installPkgs(['is-positive'], opts)

  // there was an issue when subsequent installations were removing everything installed prior
  // https://github.com/pnpm/pnpm/issues/808
  await installPkgs(['is-negative'], opts)

  const isPositive = require(path.join(globalPrefix, 'node_modules', 'is-positive'))
  t.ok(typeof isPositive === 'function', 'isPositive() is available')

  const isNegative = require(path.join(globalPrefix, 'node_modules', 'is-negative'))
  t.ok(typeof isNegative === 'function', 'isNegative() is available')
})

test('always install latest when doing global installation without spec', async function (t: tape.Test) {
  await addDistTag('peer-c', '2.0.0', 'latest')

  const project = prepare(t)
  const globalPrefix = process.cwd()
  const opts = testDefaults({global: true, prefix: globalPrefix})

  await installPkgs(['peer-c@1'], opts)
  await installPkgs(['peer-c'], opts)

  t.equal(project.requireModule('peer-c/package.json').version, '2.0.0')
})
