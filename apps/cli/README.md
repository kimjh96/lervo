# @lervo/cli

Lervo manages AI agent execution, evidence, and repository knowledge in local repositories. Initialization and help work locally without a Hub.

## Prerequisites

Node.js 22.13 or later is required. Configure a provider separately from installation and initialization when a workflow needs one.

## Install

```sh
npm install --global @lervo/cli
```

## First run

Initialize a repository and inspect available commands:

```sh
lervo init --name my-project
lervo --help
```

Preview initialization without writing files:

```sh
lervo init --dry-run --name my-project
```
