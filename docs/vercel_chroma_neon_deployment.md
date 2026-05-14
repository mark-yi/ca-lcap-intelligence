# Vercel + Neon + Chroma Cloud Deployment

This repo can now run as a small Next.js app, REST API, and MCP server on Vercel.

The deployed shape is:

```text
Next.js on Vercel
  /                         AE demo UI
  /api/opportunities        deterministic Dashboard + LCAP spend query
  /api/search               Chroma Cloud hybrid narrative search
  /api/districts/[cdsCode]  account context endpoint
  /api/mcp                  MCP endpoint for Codex, Claude, Cursor, etc.

Neon Postgres
  flattened district, LCAP, Dashboard, and chunk metadata tables

Chroma Cloud
  section-tagged LCAP narrative chunks
  dense Qwen embeddings + sparse Splade embeddings
  RRF hybrid search with optional district grouping
```

## 1. Rotate The Pasted Secrets

The Chroma and Neon credentials were pasted into a chat. Before putting this on
a public repo or public Vercel project, rotate them in Chroma Cloud and Neon.
Then use the new values below.

Do not commit `.env.local`.

## 2. Local Environment

Create `.env.local` from `.env.example`:

```sh
cp .env.example .env.local
```

Fill these values locally:

```text
DATABASE_URL=...
DATABASE_URL_UNPOOLED=...
CHROMA_HOST=api.trychroma.com
CHROMA_API_KEY=...
CHROMA_TENANT=...
CHROMA_DATABASE=...
CHROMA_COLLECTION=lcap_narrative_chunks
DEMO_API_KEY=...
LOCAL_ANALYTICS_SQLITE=outputs/analytics/2025/analytics.sqlite
LOCAL_RAG_SQLITE=outputs/rag/2025/lcap_retrieval.sqlite
```

`DEMO_API_KEY` is optional. Leave it blank for a public browser demo, because
the client-side UI does not attach a secret. If set, REST and MCP requests must
send either:

```text
Authorization: Bearer <DEMO_API_KEY>
```

or:

```text
x-api-key: <DEMO_API_KEY>
```

## 3. Install

```sh
npm install
```

## 4. Migrate Neon

This copies the generated local SQLite outputs into Neon. By default it resets
the managed tables before loading the snapshot.

```sh
npm run db:migrate
```

Useful options:

```sh
npm run db:migrate -- --skip-chunks
npm run db:migrate -- --append
npm run db:migrate -- --batch-size 250
```

Neon stores the deterministic layer: districts, LCAP goals/actions/metrics,
Dashboard outcomes, and `rag_chunks` metadata/text. The app uses Neon for
numeric claims and account ranking.

## 5. Migrate Chroma Cloud

Smoke test with a small upload first:

```sh
npm run chroma:migrate -- --limit 100
```

If that works, load the full narrative chunk collection:

```sh
npm run chroma:migrate -- --reset
```

Useful options:

```sh
npm run chroma:migrate -- --batch-size 32
npm run chroma:migrate -- --section-type goal_analysis
npm run chroma:migrate -- --collection lcap_narrative_chunks
```

The Chroma collection is created with:

- dense Chroma Cloud Qwen embeddings on the document text
- sparse Chroma Cloud Splade embeddings stored in `sparse_embedding`
- full-text index on `#document`
- string indexes on district, county, school year, section, goal, action, and document IDs

Every chunk stores `cds_code`, `district_doc_id`, `source_document_id`, `chunk_index`,
`section_type`, `section_path`, pages, and goal/action metadata so search results
can be grouped or traced back to the source district.

## 6. Verify Cloud Data

```sh
npm run verify:cloud
```

This checks Neon row counts, runs a chronic absenteeism opportunity query, checks
the Chroma collection count, and runs a sample hybrid narrative search.

## 7. Run Locally

```sh
npm run dev
```

Open:

```text
http://localhost:3000
```

## 8. Add Vercel Environment Variables

In the Vercel project for this repo, add these variables for Production,
Preview, and Development as needed:

```text
DATABASE_URL
DATABASE_URL_UNPOOLED
CHROMA_HOST
CHROMA_API_KEY
CHROMA_TENANT
CHROMA_DATABASE
CHROMA_COLLECTION
DEMO_API_KEY
```

You do not need `LOCAL_ANALYTICS_SQLITE` or `LOCAL_RAG_SQLITE` on Vercel. Those
are only for local migration scripts.

For a public demo UI, leave `DEMO_API_KEY` unset and rely on Vercel project
visibility, domain obscurity, or Vercel Authentication/Password Protection if
you need a gate. For an MCP-only demo, set `DEMO_API_KEY` and configure the MCP
client to send it.

## 9. Deploy

Import this repo into Vercel as a Next.js project. Build settings can stay at
the defaults:

```text
Install Command: npm install
Build Command: npm run build
Output Directory: .next
```

After deploy:

```text
https://<your-vercel-domain>/
https://<your-vercel-domain>/api/mcp
```

For your existing `markyi.com` portfolio, keep this as a separate Vercel project
and add a subdomain such as:

```text
lcap.markyi.com
```

That avoids merging this data/API code into the portfolio repo. Vercel supports
multiple projects under the same account and separate custom domains per project.

## 10. MCP Client Config

For clients that support remote MCP over Streamable HTTP:

```json
{
  "lcap-intelligence": {
    "url": "https://<your-vercel-domain>/api/mcp"
  }
}
```

For stdio-only clients, use `mcp-remote`:

```json
{
  "lcap-intelligence": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://<your-vercel-domain>/api/mcp"]
  }
}
```

If `DEMO_API_KEY` is set, configure the client to send an auth header or use a
small proxy wrapper that adds `Authorization: Bearer <DEMO_API_KEY>`.
