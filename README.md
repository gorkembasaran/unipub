# Unipub

**One publication profile per researcher, merged from many scholarly sources.**

Researchers' publications are scattered across Web of Science, Scopus, TR Dizin,
Google Scholar, PubMed and open catalogs like OpenAlex. Unipub collects them,
matches the same person across sources (name and institution normalization),
removes duplicates and shows a single, labelled publication list per researcher.

Unipub started as a university graduation project and was tested on roughly
40–50 faculty members and 500+ publications.

<!-- TODO: screenshots (search, author profile, merge screen) in docs/screenshots/ -->
<!-- TODO: live demo link -->

## Features

- **Multi-source collection** through one adapter per source (see the table below)
- **Author matching** with person-name and institution normalization
- **Merging and de-duplication** into one catalog per author, with per-source labels
- **DOI enrichment** via Crossref
- **Admin workflows**: merge profiles, review publications, refresh requests, API activity logs
- **PDF export** of an author's publication list
- **12 UI languages** (Turkish, English, German, French, Spanish, Arabic, …)

## Data sources

The public demo only uses open data. The other adapters are for institutions
that self-host Unipub with **their own** API keys and licences.

| Source | Public demo | Self-host | Access |
|---|---|---|---|
| OpenAlex | ✅ | ✅ | Open API, CC0 data |
| Crossref | ✅ | ✅ | Open API (DOI enrichment) |
| PubMed | ✅ | ✅ | |
| TR Dizin | – | optional | |
| Web of Science | – | bring your own key | Clarivate WoS Starter API |
| Scopus | – | bring your own key | |
| Google Scholar | – | bring your own key | SerpApi |

You are responsible for complying with each provider's terms when you enable a
source.

## Repository layout

```
apps/api   NestJS 11 + MongoDB backend (adapters, matching, catalog, admin)
apps/web   Next.js 14 frontend
docker-compose.yml
```

## Quick start (Docker)

```bash
cp .env.example .env      # set JWT_SECRET, add keys only for sources you use
docker compose up --build
```

- Web: http://localhost:3001
- API: http://localhost:3000

Try the OpenAlex adapter:

```bash
curl "http://localhost:3000/openalex/authors?q=Aziz%20Sancar&limit=3"
curl "http://localhost:3000/openalex/authors/A5016678671/works?limit=20"
```

## Local development

Requirements: Node.js 22, MongoDB 7 (or `docker compose up mongo`).

```bash
# API
cd apps/api
cp .env.example .env.local
npm install
npm run start:dev          # http://localhost:3000
npm test

# Web (second terminal)
cd apps/web
cp .env.example .env.local
npm install
npm run dev -- -p 3001     # http://localhost:3001
```

More API details (endpoints, auth, Clarivate examples) are in
[apps/api/README.md](apps/api/README.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
