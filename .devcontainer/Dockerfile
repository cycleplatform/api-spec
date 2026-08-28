# syntax=docker/dockerfile:1
ARG NODE_VARIANT=24-trixie
FROM mcr.microsoft.com/devcontainers/typescript-node:${NODE_VARIANT}

ARG NPM_VERSION=12.0.2

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    jq \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

USER node

ENV NPM_CONFIG_CACHE=/home/node/.npm

RUN npm install -g "npm@${NPM_VERSION}" \
    && mkdir -p "${NPM_CONFIG_CACHE}" \
    && npm --version