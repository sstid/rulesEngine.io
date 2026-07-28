# Contributing

This repository is the public mirror for `rulesengine.io`. The source of truth
is maintained in SST's non-public Backbone monorepo.

Issues and pull requests are welcome here. A maintainer will reproduce an
accepted change in Backbone, include the appropriate semantic version bump,
and merge it there. Automation then publishes the new version to npm and
fast-forwards this repository to the released source.

Do not merge or push source changes directly to `master`. A direct change would
make the mirror diverge from the source of truth and block the next automated
sync.

## Local checks

This project uses Node.js 22 and pnpm:

```sh
corepack enable
pnpm install
pnpm lint
pnpm test
```
