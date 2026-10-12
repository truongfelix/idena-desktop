#!/usr/bin/env bash
# Builds the bundled Linux node (`npm run prepare:node`) inside an Ubuntu 22.04 container, so the binary requires no
# glibc newer than 2.35. On a newer build host the wasm binding's optional pidfd_spawnp/pidfd_getpid calls link to
# GLIBC_2.39, and the node then does not start on Ubuntu 22.04 or Debian 12. Uses the host's Go and Node (mounted
# read-only) and writes build/node/current/idena-go; check the result with scripts/check-node-glibc.js.
# Extra `docker run` arguments: IDENA_NODE_BUILD_DOCKER_ARGS; GOPROXY, GOSUMDB and GOFLAGS are passed through.
set -euo pipefail

image="${IDENA_NODE_BUILD_IMAGE:-ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401}"
root="$(cd "$(dirname "$0")/.." && pwd)"
goroot="$(go env GOROOT)"
noderoot="$(dirname "$(dirname "$(command -v node)")")"
read -r -a extra_args <<< "${IDENA_NODE_BUILD_DOCKER_ARGS:-}"

docker run --rm \
  -v "${root}:/src" -w /src \
  -v "${goroot}:/opt/go:ro" \
  -v "${noderoot}:/opt/node:ro" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e GOPROXY -e GOSUMDB -e GOFLAGS \
  "${extra_args[@]}" \
  "${image}" \
  bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends gcc libc6-dev git ca-certificates > /dev/null
    git -C / config --global --add safe.directory "*"
    export PATH="/opt/go/bin:/opt/node/bin:${PATH}" GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod
    ldd --version | sed -n 1p
    status=0
    node scripts/prepare-bundled-node.js || status=$?
    if [ -d build/node ]; then chown -R "${HOST_UID}:${HOST_GID}" build/node; fi
    exit "${status}"
  '
