const buildOutputPatterns = [
  '<rootDir>/renderer/.next/',
  '<rootDir>/renderer/out/',
  '<rootDir>/dist/',
  '<rootDir>/node_modules/',
]

module.exports = {
  modulePathIgnorePatterns: buildOutputPatterns,
  testPathIgnorePatterns: buildOutputPatterns,
  watchPathIgnorePatterns: buildOutputPatterns,
  // @noble/curves and @noble/hashes ship ES modules only: Babel turns them into CommonJS for the tests.
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
}
