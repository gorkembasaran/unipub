# Contributing to Unipub

Thanks for helping! Issues and pull requests are welcome in English or Turkish.

## Getting started

1. Fork and clone the repository.
2. Follow **Local development** in the [README](README.md).
3. Create a branch: `feat/short-description` or `fix/short-description`.

## Before opening a pull request

```bash
cd apps/api && npm test && npx tsc --noEmit
cd apps/web && npx tsc --noEmit && npm run build
```

- Keep PRs focused on one change.
- Add or update tests for API behaviour (`apps/api/src/**/*.spec.ts`).
  Tests must not call real external APIs: mock `fetch` like the existing specs do.
- **Never commit API keys or `.env` files.** Use `.env.example` for new
  variables (empty value plus a short comment).

## Adding a new data source

Each source lives in its own Nest module under `apps/api/src/<source>/`
(see `apps/api/src/openalex/` for a small, complete example):

- `<source>.service.ts`: HTTP calls, timeouts, and normalization into plain
  author / work objects
- `<source>.controller.ts`: thin endpoints with input validation
- `<source>.service.spec.ts`: unit tests with a mocked `fetch`
- register the module in `apps/api/src/app.module.ts`
- document new env variables in `apps/api/.env.example` and `.env.example`

Only add sources whose terms allow the use you intend. Commercial sources must
stay optional and keyed by the person who self-hosts.

## Reporting security issues

Please do not open a public issue for security problems or leaked credentials.
Contact the maintainer privately through GitHub instead.
