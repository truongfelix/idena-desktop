import {lt, valid} from 'semver'

// A hard fork update is one whose release declares a hard fork (main/hard-fork-info.js), never a mere jump of the
// version number.
export function isHardForkUpdate(currentVersion, remoteVersion, hardFork) {
  return Boolean(
    hardFork &&
      currentVersion !== '0.0.1' &&
      valid(currentVersion) &&
      valid(remoteVersion) &&
      hardFork.version === valid(remoteVersion) &&
      lt(currentVersion, remoteVersion)
  )
}
