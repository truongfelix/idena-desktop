#!/bin/bash
# Signs a desktop release with the release key, a GPG key that stays offline with the developer (never in the
# repository or on GitHub). Its public half is release-signing-key.asc, at the repository's root.
#   scripts/sign-release.sh new-key     once: makes the release key, writes release-signing-key.asc
#   scripts/sign-release.sh <tag>       signs the draft release <tag> before it is published
#   scripts/sign-release.sh sign-dir <dir>   the signing step alone, on a folder (what <tag> runs on the download)
# <tag> downloads the draft's SHA256SUMS.txt and .deb, checks the list against GitHub's digests of every package and
# the .deb against the list, signs both (detached, SHA256SUMS.txt.asc and <deb>.asc), checks the signatures with
# release-signing-key.asc, and uploads them to the draft. The key lives in $IDENA_RELEASE_GNUPGHOME (default
# ~/idena-keys/gnupg); gpg asks for its passphrase.
set -euo pipefail
start=$PWD
cd "$(dirname "$0")/.."

gnupghome=${IDENA_RELEASE_GNUPGHOME:-$HOME/idena-keys/gnupg}
public_key=$(realpath -m "${IDENA_RELEASE_PUBLIC_KEY:-release-signing-key.asc}")
repo=${IDENA_RELEASE_REPO:-truongfelix/idena-desktop}
uid='truongfelix Idena desktop releases'

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fail() {
  echo "$*" >&2
  exit 1
}

# The fingerprint of the one primary key in a public key file, read without touching any keyring.
file_fingerprint() {
  mkdir -p -m 700 "$scratch/show"
  gpg --homedir "$scratch/show" --batch --show-keys --with-colons "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'
}

# The fingerprints of the secret keys in the release keyring.
secret_fingerprints() {
  gpg --homedir "$gnupghome" --batch --list-secret-keys --with-colons 2>/dev/null |
    awk -F: '$1 == "sec" { primary = 1; next } $1 == "fpr" && primary { print $10; primary = 0 }'
}

new_key() {
  [ ! -e "$public_key" ] || fail "$public_key exists already: one key signs every release"
  mkdir -p -m 700 "$gnupghome"
  [ -z "$(secret_fingerprints)" ] || fail "$gnupghome holds a secret key already: export it with gpg --homedir"
  gpg --homedir "$gnupghome" --quick-generate-key "$uid" ed25519 sign never
  gpg --homedir "$gnupghome" --armor --export "$uid" >"$public_key"
  echo "Release key made in $gnupghome; its public half is $public_key."
  echo "Fingerprint: $(file_fingerprint "$public_key")"
  echo "Keep $gnupghome/openpgp-revocs.d (the key's revocation certificate) with the key."
}

sign_dir() {
  local dir=$1 fpr deb line
  [ -f "$public_key" ] || fail "$public_key is missing: make the key first ($0 new-key)"
  fpr=$(file_fingerprint "$public_key")
  [ -n "$fpr" ] || fail "$public_key holds no key"
  secret_fingerprints | grep -qx "$fpr" || fail "$gnupghome holds no secret key for $fpr ($public_key)"
  [ -f "$dir/SHA256SUMS.txt" ] || fail "$dir/SHA256SUMS.txt is missing"
  shopt -s nullglob
  local debs=("$dir"/*.deb)
  shopt -u nullglob
  [ ${#debs[@]} -gt 0 ] || fail "$dir holds no .deb"

  for deb in "${debs[@]}"; do
    deb=$(basename "$deb")
    line=$(grep -E "^[0-9a-f]{64}  ${deb//./\\.}\$" "$dir/SHA256SUMS.txt") || fail "SHA256SUMS.txt has no line for $deb"
    (cd "$dir" && sha256sum --quiet --check <<<"$line") || fail "$deb does not match SHA256SUMS.txt"
  done

  gpg --dearmor <"$public_key" >"$scratch/release-key.gpg"
  for f in "$dir/SHA256SUMS.txt" "${debs[@]}"; do
    rm -f "$f.asc"
    gpg --homedir "$gnupghome" --local-user "$fpr!" --armor --detach-sign --output "$f.asc" "$f"
    gpgv --keyring "$scratch/release-key.gpg" "$f.asc" "$f" 2>/dev/null || fail "$f.asc does not verify"
    echo "Signed $(basename "$f") ($(basename "$f").asc)"
  done
}

sign_tag() {
  local tag=$1 dir=$scratch/release name digest
  [ "$(gh release view "$tag" -R "$repo" --json isDraft --jq .isDraft)" = true ] ||
    fail "$tag is not a draft release of $repo: sign before publishing"
  mkdir "$dir"
  gh release download "$tag" -R "$repo" --dir "$dir" --pattern SHA256SUMS.txt --pattern '*.deb'

  # Every package GitHub serves has the sum the list gives, and the list names every package.
  gh release view "$tag" -R "$repo" --json assets \
    --jq '.assets[] | select(.name != "SHA256SUMS.txt" and (.name | endswith(".asc") | not)) | "\(.name) \(.digest)"' \
    >"$scratch/digests"
  [ -s "$scratch/digests" ] || fail "$tag has no packages"
  while read -r name digest; do
    grep -qx "${digest#sha256:}  $name" "$dir/SHA256SUMS.txt" ||
      fail "$name: GitHub's digest $digest is not the one in SHA256SUMS.txt"
  done <"$scratch/digests"
  [ "$(wc -l <"$dir/SHA256SUMS.txt")" -eq "$(wc -l <"$scratch/digests")" ] ||
    fail "SHA256SUMS.txt and the release's packages differ in number"

  sign_dir "$dir"
  gh release upload "$tag" -R "$repo" --clobber "$dir"/*.asc
  echo "Uploaded the signatures to the draft $tag: check its page, then publish it."
}

case "${1:-}" in
  new-key) [ $# -eq 1 ] || fail "usage: $0 new-key"; new_key ;;
  sign-dir) [ $# -eq 2 ] || fail "usage: $0 sign-dir <dir>"; sign_dir "$(cd "$start" && cd "$2" && pwd)" ;;
  v*) [ $# -eq 1 ] || fail "usage: $0 <tag>"; sign_tag "$1" ;;
  *) fail "usage: $0 new-key | <tag> | sign-dir <dir>" ;;
esac
