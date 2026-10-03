jest.mock('./idena-node', () => ({
  downloadNode: jest.fn(),
  getRemoteVersion: jest.fn(),
  nodeExists: jest.fn(() => true),
  getCurrentVersion: jest.fn(),
}))
jest.mock('./stores/settings', () => ({persistZoomLevel: jest.fn()}))

const {getRemoteVersion} = require('./idena-node')
const NodeUpdater = require('./node-updater')

function updater() {
  const logger = {info: jest.fn(), warn: jest.fn(), error: jest.fn()}
  const nodeUpdater = new NodeUpdater(logger)
  nodeUpdater.currentVersion = '1.1.2'
  return {nodeUpdater, logger}
}

describe('node update check', () => {
  afterEach(() => jest.clearAllMocks())

  it('takes "Not Found" (no release published) as no update', async () => {
    getRemoteVersion.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        response: {status: 404},
      })
    )
    const {nodeUpdater, logger} = updater()
    expect(await nodeUpdater.doUpdateCheck()).toBe(false)
    clearTimeout(nodeUpdater.timeout)
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('no node release published yet')
  })

  it('still logs other errors', async () => {
    getRemoteVersion.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        response: {status: 500},
      })
    )
    const {nodeUpdater, logger} = updater()
    expect(await nodeUpdater.doUpdateCheck()).toBe(false)
    clearTimeout(nodeUpdater.timeout)
    expect(logger.error).toHaveBeenCalledWith(
      'error while checking update',
      'Error: Request failed with status code 500'
    )
  })
})
