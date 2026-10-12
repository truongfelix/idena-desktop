# Idena Desktop

## Research disclaimer

This is experimental research software. I cannot guarantee its security, correctness, or fitness for any purpose. Use it at your own risk, take responsibility for your decisions, independently verify changes, and stay vigilant.

Idena Desktop client for Windows, macOS, and Linux.

Built with [Electron](https://www.electronjs.org),
[React](https://react.dev), and [Next.js](https://nextjs.org/).

[![Lint and tests](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml/badge.svg?branch=master)](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml)

> Community build: [releases](https://github.com/truongfelix/idena-desktop/releases) for Linux, macOS and Windows,
> not signed with a publisher certificate (macOS and Windows warn before the first start). Back up your data folder
> before switching from the official app: see [Install](#install).

## Community build

This is the community build maintained at [github.com/truongfelix](https://github.com/truongfelix). It runs on the
same chain and rules as the official app (consensus v12, no hard fork). Contact: the GitHub account.

What it changes for users (October 2026):

- **Its own node**: the bundled node is built from
  [truongfelix/idena-go](https://github.com/truongfelix/idena-go) and replaces an older or official node found in
  the app's data folder. The node is stopped cleanly when the app quits, a node that stops by itself is reported
  (troubleshooting screen), and a restart never starts two nodes.
- **Validation**: the validation in progress is saved again (a restart or a page change no longer loses it); Quit
  works on the validation pages; the "Wrong time" warning comes from the node's own clock check and stays.
- **Ads**: an ad review sent about 13,000 iDNA as "refundable deposit" (at 114 identities) while the oracle voting
  contract refunds only 5,000; the rest went to the oracles. It now sends the 5,000 the contract needs (refunded
  whether the ad is approved or rejected), ad reviews are no longer shown to oracles as malicious, and sending an
  ad to review works again. The same review costs apply in the official app.
- **Social**: idena.social in the app, read from the app's own node (the posts of the current contract and of
  the older ones), as on the phone app; like, reply, comment, tip and post from the app.
- **History and transactions**: the History page and the transaction details come from the node's own records;
  no scan.idena.io links are left.
- **Practice validation** in the app: the validation screens with sample flips and their answers; nothing goes to
  the node.
- **Flips**: the image editor moves, scales, rotates and crops a picture; the Protect step no longer gets stuck,
  and an empty image-search pick keeps the picture; the picture search asks before its first use.
- **Contacts**: the saved contacts show at once; invites and terminations waiting in the mempool show, and a
  dropped transaction ends the wait.
- **No api.idena.io**: the clock check, the staking APY (staking and mining, from the node), the robot avatars
  (drawn by the app), the oracle votings, the validation report and the hard-fork screen no longer call api.idena.io
  or robohash.idena.io; the oracle To-Do badge reads every 5 minutes, only for validated identities. Still outside:
  translation.idena.io (flip keyword translations), GitHub (new app and node versions) and, only when you search
  for a picture, DuckDuckGo, Openverse and Wikimedia.
- **Updates**: the app tells you when a newer version is published here and opens its page (pre-releases are
  not announced); it downloads and installs nothing by itself. Help > "Report a problem" opens the issues.
- **New settings**: Settings > Node > Advanced settings, for the built-in node (the phone app has the same):
  - Peer level: Eco (up to 7 peers), Normal (up to 18, Idena default) or Hub (up to 30: twice the incoming
    slots, for nodes that reach this computer through its port open on the router).
  - IPFS connections: 20, 50 (Idena default), 100 or no limit; a limit too low for the peer level is raised
    (20 needs Eco, 50 Eco or Normal).
  - Chain database and IPFS database write buffers (4 to 64 MiB each): fewer disk writes for more memory.
  - Direct peers: up to 3 nodes kept connected beyond the peer slots, shared as a peer code.
  - Router port: opens the node's port on the home router (UPnP) for a chosen time, so that outside nodes can
    connect; the app looks for the router only when asked.

  The node takes them at its start; the page offers a restart. A node binary without the flags (an official
  one) keeps idena-go's defaults and the page shows these settings as fixed.

## Fork status

The renderer keeps the official app's data layout. History, Social, the
validation report and Oracle votings use RPC methods that only this community
node serves (an official node used as an external node lacks them). The
bundled node is built from the exact `idena-go` and
`idena-wasm-binding` commits in `scripts/source-manifest.json`; source setup
verifies those commits and required files before building.

### What was updated

- Node `24.18.0`, npm `11.16.0`, Electron `43.7.7`, Next.js `16.3`, and
  compatible renderer dependencies replace the legacy Node 10-era toolchain.
- Desktop API keys are generated with a cryptographically secure random source
  and private files are created with user-only permissions.
- The picture search for flips asks DuckDuckGo, Openverse and Wikimedia, only
  after the user agrees, behind validated, normalized result handling and
  regression tests.
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

- This fork is not an official Idena release, and its packages are not signed
  with a publisher certificate: operating systems warn before the first start.
- Electron and Next.js upgrades can expose UI, database, native-module, or
  packaging regressions that unit tests do not reproduce.
- `npm start` is a development mode. Do not rely on it for an unattended or
  valuable validation session.
- Back up the complete `userData` directory before switching between upstream
  and fork builds. Never run two clients against the same node database.
- Native node builds use CGO and must be built on the target operating system;
  the build script intentionally rejects cross-platform packaging.

## Getting started

### Install

Download the package for your system from the
[releases page](https://github.com/truongfelix/idena-desktop/releases) and check it against the release's
`SHA256SUMS.txt` (Linux: `sha256sum <file>`; macOS: `shasum -a 256 <file>`; Windows PowerShell:
`Get-FileHash <file>`).

**Before switching from the official app**, quit it and copy its whole data folder (paths under
[Configuration](#configuration)). This app takes the folder over (same account, same node key), and its node
converts the IPFS folder in it to a newer format that the official node does not open: going back needs that copy.
The folder holds your node key: keep the copy private.

- **Linux** (64-bit; Ubuntu 22.04, Debian 12 or newer): `sudo apt install ./idena-client-linux-<version>.deb`. It
  replaces the official app's package.
- **macOS** (`mac-arm64` for Apple Silicon, `mac-x64` for Intel): open the `.dmg` and drag Idena to Applications. On
  the first start macOS says it cannot verify the app: click Done, open System Settings > Privacy & Security, click
  "Open Anyway" next to the message about Idena, and confirm. On macOS 14 or older, Control-click the app and choose
  Open instead.
- **Windows** (10 or 11, 64-bit): run `idena-client-win-<version>.exe`. If SmartScreen says "Windows protected your
  PC", click "More info", then "Run anyway". It installs over the official app. With Smart App Control on, Windows
  blocks apps without a publisher certificate.

Problems: [open an issue](https://github.com/truongfelix/idena-desktop/issues).

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
- Go `1.26.9`
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

Use `npm run pack` for an unpacked local test build. A `v*` tag makes the release
workflow build every package (Linux, macOS Apple Silicon and Intel, Windows) and
one draft release with them and a `SHA256SUMS.txt`; a tag with a hyphen makes a
pre-release. Publishing the draft stays a manual step.

Pull requests are welcome.

## Contributing

### Localization

Please check your language plurals [here](https://jsfiddle.net/sm9wgLze).

## Credits

The robot avatars are drawn by the app (no request to robohash.idena.io): RoboHash set1 "Classic
robots" by Zikri Kader (CC-BY-3.0 / CC-BY-4.0) and the RoboHash selection code (e1ven/Robohash, MIT),
ported to `renderer/shared/utils/robohash.js`. Details in `renderer/public/static/robohash/CREDITS.txt`.
