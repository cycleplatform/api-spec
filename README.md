# Cycle API Spec

<a href="https://cycle.io">
<picture class="red">
  <source media="(prefers-color-scheme: dark)" srcset="https://static.cycle.io/icons/logo/logo-white.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://static.cycle.io/icons/logo/cycle-logo-fullcolor.svg">
  <img alt="cycle" width="300px" src="https://static.cycle.io/icons/logo/cycle-logo-fullcolor.svg">
</picture>
</a>

This repository contains the [OpenAPI](https://www.openapis.org/) definitions for the [Cycle API](https://cycle.io/docs/api/platform). It is used in several downstream API clients and projects, and is the basis of our API documentation.

⚠️ This spec is still under development. While most endpoints should be stable, there are still edge cases and small discrepancies that are actively being worked on. While no major breaking changes are expected, we can't guarantee that any downstream clients won't be affected by changes to schemas.

## APIs

### Platform API

https://api.cycle.io

[Documentation](https://cycle.io/docs/api/platform)

The platform API is the general use API for the Cycle Platform, and is available to all Cycle customers. It is the same API consumed by Cycle's portal, and is the main way to interact with all aspects of the platform.

See the [platform](./platform/) folder for implementation.

### Internal API

[Documentation](https://cycle.io/docs/api/internal)

Inside every container running on Cycle, there is a Unix socket mounted at `/var/run/cycle/api/api.sock`. You can send HTTP requests over this socket to access information about the local environment, access secrets, and much more. The way this internal API functions is very similar to how Cycle's main API works, though the purpose is different. The internal API is primarily used by instances to learn about their environment, and dynamically update as deployments change.

See the [internal](./internal/) folder for implementation.

### Scheduler API

[Documentation](https://cycle.io/docs/api/scheduler)

The scheduler API is used to interact with the [Scheduler Service](https://cycle.io/docs/platform/scheduler-service) inside of
an environment on Cycle. The scheduler service can be accessed from other containers in the environment over the private network,
or the scheduler service can be [made available over the public internet](https://cycle.io/docs/platform/scheduler-service).

See the [scheduler](./scheduler/) folder for implementation.

### Infrastructure Abstraction Layer API

[Documentation](https://cycle-ial.redoc.ly/)

Cycle's Infrastructure Abstract Layer (IAL) API. Endpoints listed here should be implemented by the customer, and Cycle will call the various endpoints over the lifecycle of provisioning and decommissioning servers.

For more information, check out the official [Infrastructure Abstraction Layer Documentation](https://cycle.io/docs/platform/infrastructure-abstraction-layer).

### Stack Spec

While not truly an API spec, the stack spec defines the JSON schema for a [Cycle Stack File](https://cycle.io/docs/platform/introduction-to-stacks). The JSON schema is useful for editor validation etc.

The compiled stack spec schema is committed to this repo and hosted on [JSON Schema Store](https://www.schemastore.org/json/)

## Building the APIs

The APIs can be consumed by tools that support stitching together specs divided between multiple files, or built
into a single file using the [Redocly CLI](https://redocly.com/redocly-cli/).

### Prerequisites

You must have `npm` installed on your machine, or run inside a container with `npm` in the PATH.

### Building the Platform API

`npm run build:platform`

The outputted file is located at `/dist/platform.yml`

### Building the Internal API

`npm run build:internal`

The outputted file is located at `/dist/internal.yml`

### Building the Scheduler API

`npm run build:scheduler`

The outputted file is located at `/dist/scheduler.yml`

### Building the Infrastructure Abstraction Layer API

`npm run build:ial`

The outputted file is located at `/dist/ial.yml`

### Building the Stack Spec

`npm run build:stackspec`

This will build the stack spec into a single JSON schema file, and save it to ./stackspec/stackspec.json.

**This file should be committed to the repo.**

## Downconverting to OpenAPI 3.0.3

The API specs in this repo are written using the OpenAPI 3.1.0 standard. Some code generators and other tools haven't yet
been updated to support 3.1.0, which can be an inconvenience. For us, it seems nearly all golang client generators don't
support 3.1.0 (if you find one let us know!).

To resolve this, we've created a script that will downconvert the openapi spec to 3.0.3. Of course, some fidelity is lost
with these conversions, so it may not be a perfect 1:1 with the 'true' spec, but hopefully is good enough to generate clients
off of when necessary.

To downconvert, run `npm run downconvert:platform`. The script will output to `dist/platform-3.0.3.yml`.
