const {
  MIN_NODE_BINARY_SIZE,
  assertSafeNodeDownloadUrl,
  isSafeNodeDownloadUrl,
  parseNodeChecksum,
  validateDownloadedNode,
} = require('./node-download-safety')

describe('node download safety', () => {
  it('allows only Idena node release asset URLs from GitHub', () => {
    expect(
      isSafeNodeDownloadUrl(
        'https://github.com/truongfelix/idena-go/releases/download/v1.1.2/idena-node-mac-1.1.2'
      )
    ).toBe(true)

    expect(
      isSafeNodeDownloadUrl(
        'https://github.com/other/idena-go/releases/download/v1.1.2/idena-node-mac'
      )
    ).toBe(false)
    expect(
      isSafeNodeDownloadUrl(
        'http://github.com/truongfelix/idena-go/releases/download/v1.1.2/idena-node-mac'
      )
    ).toBe(false)
    expect(
      isSafeNodeDownloadUrl(
        'https://user:token@github.com/truongfelix/idena-go/releases/download/v1.1.2/idena-node-mac'
      )
    ).toBe(false)
  })

  it('returns a normalized safe node download URL', () => {
    expect(
      assertSafeNodeDownloadUrl(
        'https://github.com/truongfelix/idena-go/releases/download/v1.1.2/idena-node-linux'
      )
    ).toBe(
      'https://github.com/truongfelix/idena-go/releases/download/v1.1.2/idena-node-linux'
    )
  })

  it('parses only checksums for the expected release asset', () => {
    expect(
      parseNodeChecksum(
        `${'ab'.repeat(32)} *builds/idena-node-mac-1.1.2\n`,
        'idena-node-mac-1.1.2'
      )
    ).toBe('ab'.repeat(32))

    expect(() =>
      parseNodeChecksum(
        `${'ab'.repeat(32)} *idena-node-linux-1.1.2\n`,
        'idena-node-mac-1.1.2'
      )
    ).toThrow('Invalid Idena node checksum')
  })

  it('validates size and version before installing a downloaded node binary', async () => {
    const getBinaryVersion = jest.fn().mockResolvedValue('1.1.2')
    const stat = jest.fn().mockResolvedValue({size: MIN_NODE_BINARY_SIZE})
    const chmod = jest.fn().mockResolvedValue(undefined)
    const calculateSha256 = jest.fn().mockResolvedValue('ab'.repeat(32))

    await expect(
      validateDownloadedNode({
        filePath: '/tmp/idena-go',
        expectedVersion: 'v1.1.2',
        expectedSha256: 'ab'.repeat(32),
        getBinaryVersion,
        stat,
        chmod,
        calculateSha256,
        platform: 'darwin',
      })
    ).resolves.toBe('1.1.2')

    expect(chmod).toHaveBeenCalledWith('/tmp/idena-go', 0o755)
    expect(calculateSha256).toHaveBeenCalledWith('/tmp/idena-go')
    expect(getBinaryVersion).toHaveBeenCalledWith('/tmp/idena-go')
  })

  it('rejects unexpectedly small node binaries', async () => {
    await expect(
      validateDownloadedNode({
        filePath: '/tmp/idena-go',
        expectedVersion: '1.1.2',
        expectedSha256: 'ab'.repeat(32),
        getBinaryVersion: jest.fn(),
        stat: jest.fn().mockResolvedValue({size: MIN_NODE_BINARY_SIZE - 1}),
        chmod: jest.fn().mockResolvedValue(undefined),
        calculateSha256: jest.fn(),
      })
    ).rejects.toThrow('unexpectedly small')
  })

  it('rejects node binaries that report the wrong version', async () => {
    await expect(
      validateDownloadedNode({
        filePath: '/tmp/idena-go',
        expectedVersion: '1.1.2',
        expectedSha256: 'ab'.repeat(32),
        getBinaryVersion: jest.fn().mockResolvedValue('1.1.1'),
        stat: jest.fn().mockResolvedValue({size: MIN_NODE_BINARY_SIZE}),
        chmod: jest.fn().mockResolvedValue(undefined),
        calculateSha256: jest.fn().mockResolvedValue('ab'.repeat(32)),
      })
    ).rejects.toThrow('version mismatch')
  })

  it('rejects node binaries whose checksum does not match', async () => {
    await expect(
      validateDownloadedNode({
        filePath: '/tmp/idena-go',
        expectedVersion: '1.1.2',
        expectedSha256: 'ab'.repeat(32),
        getBinaryVersion: jest.fn(),
        stat: jest.fn().mockResolvedValue({size: MIN_NODE_BINARY_SIZE}),
        chmod: jest.fn().mockResolvedValue(undefined),
        calculateSha256: jest.fn().mockResolvedValue('cd'.repeat(32)),
      })
    ).rejects.toThrow('checksum mismatch')
  })
})
