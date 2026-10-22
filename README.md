# Idena Desktop

The [Idena](https://idena.io) app for Windows, macOS and Linux, with its own built-in node. This is a community
build of the official app, maintained at [github.com/truongfelix](https://github.com/truongfelix). It runs on the
same Idena network, with the same rules: no hard fork.

[![Lint and tests](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml/badge.svg?branch=master)](https://github.com/truongfelix/idena-desktop/actions/workflows/lint.yml)

Download: [releases](https://github.com/truongfelix/idena-desktop/releases). Questions and problems:
[issues](https://github.com/truongfelix/idena-desktop/issues) (also Help > "Report a problem" in the app).
Community software, without warranty: use it at your own risk.

## What you can do

- **Run your node.** The app starts, stops and watches its built-in node, built from
  [truongfelix/idena-go](https://github.com/truongfelix/idena-go). It tells you when the node stops, and mines.
- **Validate.** The validation ceremony, saved across a restart, and a practice validation with sample flips.
- **Make flips** with the built-in picture editor and an optional picture search.
- **Wallet and identity**: send, receive, stake, invitations and contacts.
- **Idena Social**: [idena.social](https://idena.social) read from your own node, with the feed, profiles and names,
  likes, replies, tips, posts and private messages.
- **Oracle votings and ads**: vote, create votings, and send ads to review.
- **History** of your transactions, mining and validations, from your own node.
- **Node settings** (Settings > Node > Advanced settings): the peer level, the connections, the database write
  buffers, direct peers, and opening the node's port on your router.

The app talks to its own node. It calls only a few outside services:
- GitHub, to tell you of new versions, if you allow it;
- the picture search, when you search;
- the flip keyword translations.

## Install

**Switching from the official app?** Quit it and copy its whole data folder first (see [Your data](#your-data)).
This app takes the folder over, with the same account and node key. Its node converts the IPFS part of the folder to
a format the official node cannot open, so going back needs that copy. The folder holds your node key: keep the copy
private.

Download the package for your system from the [releases](https://github.com/truongfelix/idena-desktop/releases) and
check it against the release's `SHA256SUMS.txt`:
- Linux: `sha256sum <file>`;
- macOS: `shasum -a 256 <file>`;
- Windows PowerShell: `Get-FileHash <file>`.

The packages are not signed with a publisher certificate, so macOS and Windows warn before the first start:

- **Linux** (64-bit; Ubuntu 22.04, Debian 12 or newer): `sudo apt install ./idena-client-linux-<version>.deb`.
- **macOS** (`mac-arm64` for Apple Silicon, `mac-x64` for Intel): open the `.dmg` and drag Idena to Applications.
  On the first start, open System Settings > Privacy & Security and click "Open Anyway" next to the message about
  Idena. On macOS 14 or older, Control-click the app and choose Open.
- **Windows** (10 or 11, 64-bit): run `idena-client-win-<version>.exe`. If SmartScreen warns, click "More info",
  then "Run anyway". With Smart App Control on, Windows blocks apps without a publisher certificate.

New to Idena? See its [questions and answers](https://idena.io/?view=faq) and [guide](https://idena.io/?view=guide).

## Your data

| | Data folder (settings, node, key) | Logs |
|---|---|---|
| Windows | `%APPDATA%\Idena` | `%APPDATA%\Idena\logs` |
| macOS | `~/Library/Application Support/Idena` | `~/Library/Logs/Idena` |
| Linux | `~/.config/Idena` | `~/.config/Idena/idena.log` |

The node's files are in the `node` folder inside the data folder, laid out as for a standalone node. Back up the
whole data folder before switching between builds, and never run two apps on the same folder.

## Build from source

You need Node.js 24.22.1 with npm 11.16, Go 1.26.10, a C compiler and Git. Build on the system you package for.

```bash
npm ci
npm run setup:sources        # the node and contract runtime at the commits in scripts/source-manifest.json
npm test -- --runInBand && npm run lint && npm run release:check
npm start                    # development mode
npm run dist                 # package for this system (dist:win, dist:mac, dist:mac:arm64, dist:linux)
```

A `v*` tag makes the release workflow build every package into a draft release with its `SHA256SUMS.txt`. A tag with
a hyphen makes a pre-release.

Pull requests are welcome. Translations: check your language's plurals [here](https://jsfiddle.net/sm9wgLze).

## Credits and license

The robot avatars are drawn by the app, from the RoboHash set1 "Classic robots" by Zikri Kader (CC-BY-3.0 /
CC-BY-4.0) and the RoboHash selection code (e1ven/Robohash, MIT), ported to `renderer/shared/utils/robohash.js`.
Details are in `renderer/public/static/robohash/CREDITS.txt`.

License: MIT (see `LICENSE`).
