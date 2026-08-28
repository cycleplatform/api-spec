#!/usr/bin/env bash
set -euo pipefail

NPM_CACHE="${NPM_CONFIG_CACHE:-${HOME}/.npm}"

for dir in "${PWD}/node_modules" "${NPM_CACHE}"; do
    mkdir -p "${dir}" 2>/dev/null || sudo mkdir -p "${dir}"
    if [ "$(stat -c '%U' "${dir}")" != "node" ]; then
        sudo chown node:node "${dir}"
    fi
done

if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi

printf '\n'
printf 'node    %s\n' "$(node --version)"
printf 'npm     %s\n' "$(npm --version)"
printf 'tsc     %s\n' "$(npm exec -- tsc --version)"
printf 'cache   %s\n' "$(npm config get cache)"