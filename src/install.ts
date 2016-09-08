import createDebug from './debug'
const debug = createDebug('pnpm:install')
import npa = require('npm-package-arg')
import fs = require('mz/fs')
import logger = require('@zkochan/logger')

import path = require('path')
const join = path.join
const dirname = path.dirname
const basename = path.basename
const abspath = path.resolve

import fetch from './fetch'
import resolve from './resolve'

import mkdirp from './fs/mkdirp'
import requireJson from './fs/require_json'
import relSymlink from './fs/rel_symlink'

import linkBundledDeps from './install/link_bundled_deps'
import isAvailable from './install/is_available'
import installAll from './install_multiple'

/*
 * Installs a package.
 *
 *     install(ctx, 'rimraf@2', './node_modules')
 *
 * Parameters:
 *
 * - `ctx` (Object) - the context.
 *   - `root` (String) - root path of the package.
 *   - `log` (Function) - logger
 *
 * What it does:
 *
 * - resolve() - resolve from registry.npmjs.org
 * - fetch() - download tarball into node_modules/.store/{name}@{version}
 * - recurse into its dependencies
 * - symlink node_modules/{name}
 * - symlink bins
 */

export default function install (ctx, pkgMeta, modules, options) {
  debug('installing ' + pkgMeta.rawSpec)
  if (!ctx.builds) ctx.builds = {}
  if (!ctx.fetches) ctx.fetches = {}
  if (!ctx.ignoreScripts) ctx.ignoreScripts = options && options.ignoreScripts

  const pkg: any = {
    // Preliminary spec data
    // => { raw, name, scope, type, spec, rawSpec }
    spec: npa(pkgMeta.rawSpec),

    optional: pkgMeta.optional || options.optional,

    // Dependency path to the current package. Not actually needed anmyore
    // outside getting its length
    // => ['babel-core@6.4.5', 'babylon@6.4.5', 'babel-runtime@5.8.35']
    keypath: (options && options.keypath || []),

    // Full name of package as it should be put in the store. Aim to make
    // this as friendly as possible as this will appear in stack traces.
    // => 'lodash@4.0.0'
    // => '@rstacruz!tap-spec@4.1.1'
    // => 'rstacruz!pnpm@0a1b382da'
    // => 'foobar@9a3b283ac'
    fullname: undefined,

    // Distribution data from resolve() => { shasum, tarball }
    dist: undefined,

    // package.json data as retrieved from resolve() => { name, version, ... }
    data: undefined
  }

  const paths = {
    // Module storage => './node_modules'
    modules,

    // Final destination => store + '/lodash@4.0.0'
    target: undefined
  }

  const log = logger.fork(pkg.spec).log.bind(null, 'progress', pkgMeta.rawSpec)

  // it might be a bundleDependency, in which case, don't bother
  return isAvailable(pkg.spec, modules)
    .then(_ => _
      ? saveCachedResolution()
        .then(data => log('package.json', data))
      : resolve(Object.assign({}, pkg.spec, {root: options.parentRoot || ctx.root}), {log, got: ctx.got})
        .then(saveResolution)
        .then(_ => log('resolved', pkg))
        .then(_ => buildToStoreCached(ctx, paths, pkg, log))
        .then(_ => mkdirp(paths.modules))
        .then(_ => symlinkToModules(join(paths.target, '_'), paths.modules))
        .then(_ => log('package.json', requireJson(join(paths.target, '_', 'package.json')))))
    // done
    .then(_ => {
      if (!ctx.installs) ctx.installs = {}
      if (!ctx.installs[pkg.fullname]) {
        ctx.installs[pkg.fullname] = pkg
        return
      }
      ctx.installs[pkg.fullname].optional = ctx.installs[pkg.fullname].optional && pkg.optional
    })
    .then(_ => log('done'))
    .then(_ => pkg)
    .catch(err => {
      log('error', err)
      throw err
    })

  // set metadata as fetched from resolve()
  function saveResolution (res) {
    pkg.name = res.name
    pkg.fullname = res.fullname
    pkg.version = res.version
    pkg.dist = res.dist
    pkg.root = res.root
    paths.target = join(ctx.store, res.fullname)
  }

  function saveCachedResolution () {
    const target = join(modules, pkg.spec.name)
    return fs.lstat(target)
      .then(stat => {
        if (stat.isSymbolicLink()) {
          return fs.readlink(target)
            .then(path => save(abspath(path, target)))
        } else {
          return save(target)
        }
      })

    function save (fullpath) {
      const data = requireJson(join(fullpath, 'package.json'))
      pkg.name = data.name
      pkg.fullname = basename(fullpath)
      pkg.version = data.version
      pkg.data = data
      paths.target = fullpath
    }
  }
}

/*
 * Builds to `.store/lodash@4.0.0` (paths.target)
 * If an ongoing build is already working, use it. Also, if that ongoing build
 * is part of the dependency chain (ie, it's a circular dependency), use its stub
 */

function buildToStoreCached (ctx, paths, pkg, log) {
  // If a package is requested for a second time (usually when many packages depend
  // on the same thing), only resolve until it's fetched (not built).
  if (ctx.fetches[pkg.fullname]) return ctx.fetches[pkg.fullname]

  return make(paths.target, _ =>
    memoize(ctx.builds, pkg.fullname, _ =>
      Promise.resolve()
        .then(_ => memoize(ctx.fetches, pkg.fullname, _ =>
          fetchToStore(ctx, paths, pkg, log)))
        .then(_ => buildInStore(ctx, paths, pkg, log))
  ))
}

/*
 * Builds to `.store/lodash@4.0.0` (paths.target)
 * Fetches from npm, recurses to dependencies, runs lifecycle scripts, etc
 */

function fetchToStore (ctx, paths, pkg, log) {
  return Promise.resolve()
    // download and untar
    .then(_ => log('download-queued'))
    .then(_ => mkdirp(join(paths.target, '_')))
    .then(_ => fetch(join(paths.target, '_'), pkg.dist, {log, got: ctx.got}))
    .then(_ => pkg.dist.local && pkg.dist.remove ? fs.unlink(pkg.dist.tarball) : Promise.resolve())

    // TODO: this is the point it becomes partially useable.
    // ie, it can now be symlinked into .store/foo@1.0.0.
    // it is only here that it should be available for ciruclar dependencies.
}

function buildInStore (ctx, paths, pkg, log) {
  let fulldata

  return Promise.resolve()
    .then(_ => { fulldata = requireJson(abspath(join(paths.target, '_', 'package.json'))) })
    .then(_ => log('package.json', fulldata))

    .then(_ => linkBundledDeps(join(paths.target, '_')))

    // recurse down to dependencies
    .then(_ => log('dependencies'))
    .then(_ => installAll(ctx,
      fulldata.dependencies,
      fulldata.optionalDependencies,
      join(paths.target, '_', 'node_modules'),
      {
        keypath: pkg.keypath.concat([ pkg.fullname ]),
        dependent: pkg.fullname,
        parentRoot: pkg.root,
        optional: pkg.optional
      }))

    // symlink itself; . -> node_modules/lodash@4.0.0
    // this way it can require itself
    .then(_ => symlinkSelf(paths.target, fulldata, pkg.keypath.length))

    .then(_ => {
      ctx.piq = ctx.piq || []
      ctx.piq.push({
        path: paths.target,
        pkgFullname: pkg.fullname
      })
    })
}

/*
 * Symlink a package into its own node_modules. this way, babel-runtime@5 can
 * require('babel-runtime') within itself.
 */

function symlinkSelf (target, pkg, depth) {
  debug(`symlinkSelf ${pkg.name}`)
  if (depth === 0) {
    return Promise.resolve()
  } else {
    return mkdirp(join(target, 'node_modules'))
      .then(_ => relSymlink(
        join('..', '_'),
        join(target, 'node_modules', escapeName(pkg.name))))
  }
}

function escapeName (name) {
  return name && name.replace('/', '%2f')
}

/*
 * Perform the final symlinking of ./.store/x@1.0.0 -> ./x.
 *
 *     target = '/node_modules/.store/lodash@4.0.0'
 *     modules = './node_modules'
 *     symlinkToModules(fullname, modules)
 */

function symlinkToModules (target, modules) {
  // TODO: uncomment to make things fail
  const pkgData = requireJson(join(target, 'package.json'))
  if (!pkgData.name) { throw new Error('Invalid package.json for ' + target) }

  // lodash -> .store/lodash@4.0.0
  // .store/foo@1.0.0/node_modules/lodash -> ../../../.store/lodash@4.0.0
  const out = join(modules, pkgData.name)
  return mkdirp(dirname(out))
    .then(_ => relSymlink(target, out))
}

/*
 * If `path` doesn't exist, run `fn()`.
 * If it exists, don't do anything.
 */

function make (path, fn) {
  return fs.stat(path)
    .catch(err => {
      if (err.code !== 'ENOENT') throw err
      return fn()
    })
}

/*
 * Save promises for later
 */

function memoize (locks, key, fn) {
  if (locks && locks[key]) return locks[key]
  locks[key] = fn()
  return locks[key]
}