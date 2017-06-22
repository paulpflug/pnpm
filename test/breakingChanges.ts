import tape = require('tape')
import promisifyTape from 'tape-promise'
import fs = require('mz/fs')
import mkdirp = require('mkdirp-promise')
import path = require('path')
import isCI = require('is-ci')
import {prepare, testDefaults} from './utils'
import {installPkgs, install} from '../src'

const test = promisifyTape(tape)

const STORE_VERSION = '2'

test('fail on non-compatible node_modules', async t => {
  const project = prepare(t)
  const opts = testDefaults()

  await saveModulesYaml('0.50.0', path.join(opts.store, STORE_VERSION))

  try {
    await installPkgs(['is-negative'], opts)
    t.fail('should have failed')
  } catch (err) {
    t.equal(err.code, 'MODULES_BREAKING_CHANGE', 'modules breaking change error is thrown')
  }
})

test("don't fail on non-compatible node_modules when forced", async t => {
  const project = prepare(t)
  const opts = testDefaults({force: true})

  await saveModulesYaml('0.50.0', path.join(opts.store, STORE_VERSION))

  await install(opts)

  t.pass('install did not fail')
})

test('fail on non-compatible node_modules when forced with a named installation', async t => {
  const project = prepare(t)
  const opts = testDefaults({force: true})

  await saveModulesYaml('0.50.0', path.join(opts.store, STORE_VERSION))

  try {
    await installPkgs(['is-negative'], opts)
    t.fail('should have failed')
  } catch (err) {
    t.ok(err.message.indexOf('Named installation cannot be used to regenerate the node_modules structure') !== -1)
  }
})

test("don't fail on non-compatible store when forced", async t => {
  const project = prepare(t)
  const opts = testDefaults({force: true})

  await saveModulesYaml('0.32.0', path.join(opts.store, STORE_VERSION))

  await install(opts)

  t.pass('install did not fail')
})

test('fail on non-compatible store when forced during named installation', async t => {
  const project = prepare(t)
  const opts = testDefaults({force: true})

  await saveModulesYaml('0.32.0', path.join(opts.store, STORE_VERSION))

  try {
    await installPkgs(['is-negative'], opts)
    t.fail('should have failed')
  } catch (err) {
    t.ok(err.message.indexOf('Named installation cannot be used to regenerate the node_modules structure') !== -1)
  }
})

async function saveModulesYaml (pnpmVersion: string, storePath: string) {
  await mkdirp('node_modules')
  await fs.writeFile('node_modules/.modules.yaml', `packageManager: pnpm@${pnpmVersion}\nstorePath: ${storePath}\nindependentLeaves: false`)
}

test('fail on non-compatible shrinkwrap.yaml', async t => {
  if (isCI) {
    t.skip('this test will always fail on CI servers')
    return
  }

  const project = prepare(t)
  await fs.writeFile('shrinkwrap.yaml', '')

  try {
    await installPkgs(['is-negative'], testDefaults())
    t.fail('should have failed')
  } catch (err) {
    t.equal(err.code, 'SHRINKWRAP_BREAKING_CHANGE', 'shrinkwrap breaking change error is thrown')
  }
})

test("don't fail on non-compatible shrinkwrap.yaml when forced", async t => {
  const project = prepare(t)
  await fs.writeFile('shrinkwrap.yaml', '')

  await installPkgs(['is-negative'], testDefaults({force: true}))

  t.pass('install did not fail')
})
