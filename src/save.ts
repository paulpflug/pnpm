import loadJsonFile = require('load-json-file')
import writePkg = require('write-pkg')
import {DependenciesType, dependenciesTypes} from './getSaveType'
import {Package} from './types'
import {PackageSpec} from './resolve'

export default async function save (
  pkgJsonPath: string,
  packageSpecs: ({
    name: string,
    saveSpec: string,
  })[],
  saveType?: DependenciesType
): Promise<Package> {
  // Read the latest version of package.json to avoid accidental overwriting
  const packageJson = await loadJsonFile(pkgJsonPath)
  if (saveType) {
    packageJson[saveType] = packageJson[saveType] || {}
  }
  packageSpecs.forEach(dependency => {
    if (saveType) {
      packageJson[saveType][dependency.name] = dependency.saveSpec
      dependenciesTypes.filter(deptype => deptype !== saveType).forEach(deptype => {
        if (packageJson[deptype]) {
          delete packageJson[deptype][dependency.name]
        }
      })
      return
    }
    const usedDepType: DependenciesType = dependenciesTypes
      .find(deptype => packageJson[deptype] && packageJson[deptype][dependency.name]) || 'dependencies'
    packageJson[usedDepType] = packageJson[usedDepType] || {}
    packageJson[usedDepType][dependency.name] = dependency.saveSpec
  })

  await writePkg(pkgJsonPath, packageJson)
  return packageJson
}
