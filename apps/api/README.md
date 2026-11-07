# Unipub API

Unipub collects an academic's publications from several scholarly sources and
merges them into a single, de-duplicated profile. Instead of checking Web of
Science, Scopus, TR Dizin, Google Scholar and PubMed one by one, a researcher
(or their institution) gets one unified publication list.

This repository is the backend (NestJS + MongoDB). The web client lives in
[unipub-web](https://github.com/gorkembasaran/unipub-web). Unipub was built as a
university graduation project and tested on roughly 40–50 faculty members and
500–600 publications.

## What it does

- **Multi-source collection**: integrations for Web of Science (Clarivate WoS
  Starter API), Google Scholar (via SerpApi), Scopus and PubMed (custom scrapers
  through ScraperAPI) and TR Dizin.
- **Author matching**: person-name and institution normalization to match the
  same researcher across sources.
- **Merging**: publications from different sources are combined into one
  catalog per author, with duplicate detection and per-source labels.
- **Admin workflows**: JWT-protected admin endpoints for merging profiles,
  reviewing publications, refresh requests and API activity logs.
- **Profile refresh**: a monthly refresh routine that re-syncs recently viewed
  authors (the cron trigger is currently disabled).

## Tech stack

NestJS 11, TypeScript, MongoDB (Mongoose), JWT auth, Jest.

## Project structure

| Module | Responsibility |
| --- | --- |
| `clarivate` | Web of Science Starter API client |
| `serpapi` | Google Scholar author/publication search via SerpApi |
| `scraper` | Scopus and PubMed scraping via ScraperAPI |
| `trdizin` | TR Dizin search |
| `discovery` | Cross-source author discovery |
| `catalog` | Unified author/publication catalog and sync |
| `auth`, `admin` | JWT auth and admin operations |
| `maintenance` | Monthly author refresh routine |
| `activity-log` | Request logging with secret redaction |

## Project setup

```bash
$ npm install
```

## Environment

Local secrets are loaded from `.env.local` first, then `.env`.

```bash
$ cp .env.example .env.local
```

Add the Clarivate Web of Science Starter API key to `.env.local`:

```bash
CLARIVATE_WOS_STARTER_API_KEY=your_key_here
```

## Clarivate Web of Science Starter API

The API exposes two Clarivate proxy endpoints:

```bash
# Search Web of Science documents
$ curl "http://localhost:3000/clarivate/wos-starter/documents?q=AU%3D(%22Yilmaz%20Kemal%20Yuce%22)&limit=10"

# Search and normalize authors from matching documents
$ curl "http://localhost:3000/clarivate/wos-starter/authors?q=Yilmaz%20Kemal%20Yuce&limit=10"
```

The authors endpoint returns a compact author view by default: matched author,
available affiliations, and publication summaries. Clarivate Web of Science
Starter API may not include affiliation/address fields in its document response.
For debugging, append `includeCandidates=true`, `includeHits=true`, or
`includeRaw=true`.

## Authentication

Create a long random `JWT_SECRET` in `.env.local` before using protected routes:

```bash
JWT_SECRET=your_long_random_secret
JWT_EXPIRES_IN=7d
```

Auth endpoints:

```bash
# Register
curl -X POST "http://localhost:3000/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Demo User","email":"demo@example.com","password":"secret123"}'

# Login
curl -X POST "http://localhost:3000/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"secret123"}'

# Current user
curl "http://localhost:3000/auth/me" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Catalog write/sync endpoints require `Authorization: Bearer YOUR_TOKEN`.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
