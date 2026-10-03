# CLI bundle construction and inventory scope

`apps/cli/scripts/build-bundle.mjs` builds three JavaScript executables. `apps/cli/package.json` registers two `bin` commands, `lervo` and `lervo-node`; the third shipped file is the terminal hook, which is not a package `bin` command.

- [Build configuration and execution](cli-bundle-construction/build.md)
- [Metafile and release evidence](cli-bundle-construction/evidence.md)
