import path = require('path')
import fs = require('mz/fs')
import mkdirp = require('mkdirp-promise')
import rimraf = require('rimraf-then')

const ignoredFiles = {
  '.npmignore': true,
  '.travis.yml': true,
  'appveyor.yml': true,
  '.gitattributes': true,
  '.gitignore': true,
  '.editorconfig': true,
  '.npmrc': true,
  'license': true,
  'licence': true,
  'readme.md': true,
  'contributing.md': true,
  'changelog.md': true,
  'history.md': true,
}
const testFolder = `test${path.sep}`

export default async function linkIndexedDir (existingDir: string, newDir: string, index: {}) {
  const stage = `${newDir}+stage`
  try {
    await rimraf(stage)
    await tryLinkIndexedDir(existingDir, stage, index)
    await rimraf(newDir)
    await fs.rename(stage, newDir)
  } catch (err) {
    try { await rimraf(stage) } catch (err) {}
    throw err
  }
}

async function tryLinkIndexedDir (existingDir: string, newDir: string, index: {}) {
  const alldirs = new Set()
  Object.keys(index)
    .forEach(f => {
      alldirs.add(path.join(newDir, path.dirname(f)))
    })
  await Promise.all(
    Array.from(alldirs).sort((d1, d2) => d1.length - d2.length).map(dir => mkdirp(dir))
  )
  await Promise.all(
    Object.keys(index)
      .filter(f => !index[f].isDir)
      .filter(f => {
        const lf = f.toLowerCase()
        return !ignoredFiles[lf] && !lf.startsWith(testFolder)
      })
      .map((f: string) => fs.link(path.join(existingDir, f), path.join(newDir, f)))
  )
}
