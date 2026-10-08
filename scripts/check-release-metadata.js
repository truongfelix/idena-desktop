#!/usr/bin/env node

const fs = require('fs')

const failures = []
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const buildNodeScript = fs.readFileSync(
  'scripts/build-node-from-sources.js',
  'utf8'
)
const releaseWorkflow = fs.readFileSync('.github/workflows/release.yml', 'utf8')
const lintWorkflow = fs.readFileSync('.github/workflows/lint.yml', 'utf8')
const releaseCheckScript = fs.readFileSync('scripts/release-check.js', 'utf8')
const npmAuditScript = fs.readFileSync('scripts/check-npm-audit.js', 'utf8')

function requireCondition(condition, message) {
  if (!condition) failures.push(message)
}

requireCondition(
  packageJson.name === 'idena-desktop',
  'unexpected package name'
)
requireCondition(packageJson.productName === 'Idena', 'unexpected product name')
requireCondition(
  packageJson.engines &&
    packageJson.engines.node === '>=24.18.0 <25' &&
    packageJson.engines.npm === '>=11.16.0',
  'package engines must pin the Node 24 / npm 11 runtime'
)
requireCondition(fs.existsSync('.node-version'), 'missing .node-version')
requireCondition(fs.existsSync('.nvmrc'), 'missing .nvmrc')
requireCondition(
  /IDENA_GO_GOTOOLCHAIN\s*\|\|\s*['"]go1\.26\.8['"]/.test(buildNodeScript),
  'bundled node source build must default to Go 1.26.8'
)

const scripts = packageJson.scripts || {}
requireCondition(
  scripts['prepare:node'] === 'node scripts/prepare-bundled-node.js',
  'package scripts must include prepare:node for bundled idena-go'
)
requireCondition(
  /build\/node\/current\/idena-go\.exe/u.test(
    scripts['build:node:win:x64'] || ''
  ),
  'package scripts must define Windows bundled node output path'
)
requireCondition(
  /build\/node\/current\/idena-go\b/u.test(
    scripts['build:node:mac:arm64'] || ''
  ) &&
    /build\/node\/current\/idena-go\b/u.test(
      scripts['build:node:mac:x64'] || ''
    ),
  'package scripts must define macOS bundled node output paths'
)
requireCondition(
  /npm run prepare:node/u.test(releaseWorkflow),
  'release workflow must prepare the bundled node before packaging'
)
requireCondition(
  /workflow_dispatch:[\s\S]*inputs:[\s\S]*tag:/u.test(releaseWorkflow),
  'release workflow must require a semver tag input for manual dispatch'
)
requireCondition(
  /ref:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref\s*\}\}/u.test(
    releaseWorkflow
  ),
  'release workflow manual dispatch must check out the requested tag'
)
requireCondition(
  /npm test -- --runInBand/u.test(lintWorkflow),
  'push workflow must run the full unit test suite'
)
requireCondition(
  /pull_request:/u.test(lintWorkflow),
  'lint workflow must run on pull requests'
)
requireCondition(
  /npm test -- --runInBand/u.test(releaseWorkflow),
  'release workflow must run the full unit test suite before packaging'
)
// The full npm audit (dev dependencies included) runs through scripts/check-npm-audit.js, which fails on
// every advisory at moderate severity or above except dated exceptions for advisories without a fix.
requireCondition(
  /npmCommand,\s*\[\s*'run',\s*'audit:npm',?\s*\]/u.test(releaseCheckScript) &&
    packageJson.scripts['audit:npm'] === 'node scripts/check-npm-audit.js' &&
    /\['audit',\s*'--json'\]/u.test(npmAuditScript) &&
    /FAILING_SEVERITIES = new Set\(\['moderate', 'high', 'critical'\]\)/u.test(
      npmAuditScript
    ),
  'release check must include full moderate-severity npm audit'
)
requireCondition(
  /npmCommand,\s*\['audit',\s*'signatures'\]/u.test(releaseCheckScript),
  'release check must include npm registry signature audit'
)

const buildFiles = new Set(
  packageJson.build && Array.isArray(packageJson.build.files)
    ? packageJson.build.files
    : []
)

for (const pattern of [
  '!**/.env',
  '!**/.env.*',
  '!**/*.log',
  '!**/*.test.js',
  '!**/*.test.jsx',
  '!.github',
  '!.github/**',
  '!scripts',
  '!scripts/**',
  '!build',
  '!build/**',
  '!idena-go',
  '!idena-go/**',
  '!idena-wasm',
  '!idena-wasm/**',
  '!idena-wasm-binding',
  '!idena-wasm-binding/**',
  '!renderer',
  'renderer/out',
]) {
  requireCondition(
    buildFiles.has(pattern),
    `package build.files must include ${pattern}`
  )
}

for (const platform of ['mac', 'win', 'linux']) {
  const resources =
    packageJson.build &&
    packageJson.build[platform] &&
    packageJson.build[platform].extraResources
  requireCondition(
    Array.isArray(resources) &&
      resources.some(
        (entry) => entry.from === 'build/node/current' && entry.to === 'node'
      ),
    `build.${platform}.extraResources must include bundled idena-go node`
  )
}

if (failures.length > 0) {
  console.error('Release metadata check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Release metadata check passed.')
