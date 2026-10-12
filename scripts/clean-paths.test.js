const path = require('path')
const {cleanPaths, resolveCleanPath} = require('./clean-paths')

describe('clean paths script', () => {
  // Resolved: on Windows it starts with the current drive (D:\tmp\...), as the script's own paths do.
  const cwd = path.resolve(path.sep, 'tmp', 'idena-desktop')

  it('resolves relative clean paths inside the project', () => {
    expect(resolveCleanPath('renderer/out', cwd)).toBe(
      path.join(cwd, 'renderer', 'out')
    )
  })

  it('rejects absolute paths', () => {
    expect(() => resolveCleanPath(path.join(cwd, 'dist'), cwd)).toThrow(
      'absolute path'
    )
  })

  it('rejects parent traversal and project root deletion', () => {
    expect(() => resolveCleanPath('../outside', cwd)).toThrow(
      'outside the project'
    )
    expect(() => resolveCleanPath('.', cwd)).toThrow('outside the project')
  })

  it('removes only validated relative paths', () => {
    const rmSync = jest.fn()

    cleanPaths(['dist', 'renderer/.next'], {cwd, rmSync})

    expect(rmSync).toHaveBeenCalledWith(path.join(cwd, 'dist'), {
      recursive: true,
      force: true,
    })
    expect(rmSync).toHaveBeenCalledWith(path.join(cwd, 'renderer', '.next'), {
      recursive: true,
      force: true,
    })
  })
})
