# Cycle API Spec

This repository contains the [OpenAPI](https://www.openapis.org/) definitions for the [Cycle API](https://api-docs.cycle.io). It is used in several downstream API clients and projects, and is the basis of our API documentation.

⚠️ This spec is still under development. While most endpoints should be stable, there are still edge cases and small discrepancies that are actively being worked on.

While no major breaking changes are expected, we can't guarantee that any downstream clients won't be affected by changes to schemas (such as marking properties as null or required). When we believe the spec to be stable, we'll release v1.0.0.

## APIs

### Public API

The public API is the general use API for the Cycle Platform, located at https://api.cycle.io. The endpoints for this API are located under `/public`.

### Internal API

The internal API is used within containers running on the Cycle Platform, and provide a convenient means to communicate with the platform from within a container to unlock advanced use cases (such as custom monitoring/tooling).

## Building the APIs

The APIs are built using the [Redocly CLI](https://redocly.com/redocly-cli/). It stitches together the various files and combines them into a single spec file for easy consumption by other tools.

### Prerequisites

You must have `npm` installed on your machine, or run inside a container with `npm` in the PATH.

### Building the Public API

`npm run build:public`

The outputted file is located at `/dist/public-api.yml`

### Building the Internal API

`npm run build:internal`

The outputted file is located at `/dist/internal-api.yml`