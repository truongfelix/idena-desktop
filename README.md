# Idena Desktop

## Research disclaimer

This is experimental research software. I cannot guarantee its security, correctness, or fitness for any purpose. Use it at your own risk, take responsibility for your decisions, independently verify changes, and stay vigilant.

Idena Desktop client for Windows, macOS, and Linux.

Built with [Electron](https://www.electronjs.org),
[React](https://react.dev), and [Next.js](https://nextjs.org/).

[![Lint and tests](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml/badge.svg?branch=master)](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml)

> This community-maintained fork has no published or code-signed desktop
> releases. The upstream Idena release feed does not contain these changes.
> Build from a reviewed commit before using the app with a valuable identity.

## Fork status

The renderer remains compatible with the existing Idena RPC and application
data layout. The bundled node is built from the exact `idena-go` and
`idena-wasm-binding` commits in `scripts/source-manifest.json`; source setup
verifies those commits and required files before building.

### What was updated

- Node `24.18.0`, npm `11.16.0`, Electron `43.1.0`, Next.js `16.2`, and
  compatible renderer dependencies replace the legacy Node 10-era toolchain.
- Desktop API keys are generated with a cryptographically secure random source
  and private files are created with user-only permissions.
- DuckDuckGo image search was restored behind validated, normalized result
  handling and regression tests.
- The obsolete Fabric-based editor and SDK dependency were removed; the flip
  editor now uses a smaller local implementation.
- Source-built node preparation, artifact checks, privacy checks, Electron
  safety checks, dependency/signature audits, and release preflight checks are
  automated in CI.
- Native node build paths are defined for Windows x64, macOS x64/ARM64, and the
  Linux packaging flow.

### Benefits

- A current desktop runtime with fewer vulnerable and abandoned packages.
- Reproducible node and Wasm inputs instead of an unverified downloaded node.
- Reduced credential exposure and better checks for renderer, IPC, external
  URLs, image search, and packaged artifacts.

### Risks and tradeoffs

- This fork is not an official, signed Idena wallet release. Local packages are
  development artifacts and may trigger operating-system trust warnings.
- Electron and Next.js upgrades can expose UI, database, native-module, or
  packaging regressions that unit tests do not reproduce.
- `npm start` is a development mode. Do not rely on it for an unattended or
  valuable validation session.
- Back up the complete `userData` directory before switching between upstream
  and fork builds. Never run two clients against the same node database.
- Native node builds use CGO and must be built on the target operating system;
  the build script intentionally rejects cross-platform packaging.

## Getting started

There is no fork release download yet. For the official upstream application,
use the [upstream releases](https://github.com/idena-network/idena-desktop/releases/latest).
Those binaries do not include this fork's modernization work.

### Get to know Idena

Visit [Idena](https://idena.io) for the [most common questions](https://idena.io/?view=faq) and [guidelines](https://idena.io/?view=guide).

### Configuration

Most of the configuration is available in `userData` directory:

- `%APPDATA%\Idena` on Windows
- `~/Library/Application Support/Idena` on macOS
- `~/.config/Idena` on Linux

**Note:** Manual configuration can corrupt the installation or expose the RPC
interface. Edit configuration only after making a backup and understanding the
effect of each setting.

### Logs

Logs are available in `logs` directory:

- `%APPDATA%\Idena\logs` on Windows
- `~/Library/Logs/Idena` on macOS
- `~/.config/Idena/idena.log` on Linux

### Built-in node

Node configuration and data files located in `node` directory inside `userData`:

- `%APPDATA%\Idena\node` on Windows
- `~/Library/Application Support/Idena/node` on macOS
- `~/.config/Idena/node` on Linux

The built-in node directory structure is the same as for standalone node.

## Development

### Prerequisites

- Node.js `24.18.0` on the Node 24 LTS line
- npm `11.16.0`
- Go `1.26.5`
- A C compiler suitable for the host operating system
- Git

### Install dependencies

```bash
npm ci
npm run setup:sources
```

Before running or packaging, execute the maintained checks:

```bash
npm test -- --runInBand
npm run lint
npm run release:check
```

### Run

```bash
npm start
```

### Build

Builds are packaged with [electron-builder](https://www.electron.build/).
Run packaging on the target operating system.

You may build for the current platform:

```bash
npm run dist
```

or for a specific platform

```bash
npm run dist:win
npm run dist:mac
npm run dist:mac:arm64
npm run dist:mac:universal
npm run dist:linux
```

Use `npm run pack` for an unpacked local test build. Release scripts may contain
publishing flags, but no release is published unless a matching release process
and credentials are deliberately configured.

Pull requests are welcome.

## Contributing

### Localization

Please check your language plurals [here](https://jsfiddle.net/sm9wgLze).
