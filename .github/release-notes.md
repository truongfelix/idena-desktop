Community build of the Idena desktop app, from https://github.com/truongfelix/idena-desktop. It runs on the same
Idena network as the official app, with the same rules, and carries its own Idena node built from
https://github.com/truongfelix/idena-go.

The packages are not signed with a publisher certificate: macOS and Windows warn before the first start (see below).
Check what you download against the SHA-256 list at the end of these notes.

## Before you install: back up your data folder

The app uses the same data folder as the official Idena app and takes it over: same account, same node key. Its node
converts the IPFS folder in it to a newer format that the official node does not open. To be able to go back to the
official app, quit it and copy the whole folder first:

- Linux: `~/.config/Idena`
- macOS: `~/Library/Application Support/Idena`
- Windows: `%APPDATA%\Idena`

The folder holds your node key (`node/datadir/keystore/nodekey`): keep the copy private.

## Install

- **Linux** (64-bit; Ubuntu 22.04, Debian 12 or newer): download `idena-client-linux-<version>.deb`, then run
  `sudo apt install ./idena-client-linux-<version>.deb`. It replaces the official app's package.
- **macOS** (`mac-arm64` for Apple Silicon, `mac-x64` for Intel): open the `.dmg` and drag Idena to Applications.
  On the first start macOS says it cannot verify the app: click Done, open System Settings > Privacy & Security,
  click "Open Anyway" next to the message about Idena, and confirm. On macOS 14 or older, Control-click the app and
  choose Open instead.
- **Windows** (10 or 11, 64-bit): run `idena-client-win-<version>.exe`. If SmartScreen says "Windows protected your
  PC", click "More info", then "Run anyway". It installs over the official app. With Smart App Control on, Windows
  blocks apps without a publisher certificate and offers no way past it.

## Check a download

Compare the result with the line for that file below:

- Linux: `sha256sum <file>`
- macOS: `shasum -a 256 <file>`
- Windows (PowerShell): `Get-FileHash <file>`
