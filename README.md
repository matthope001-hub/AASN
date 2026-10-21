# AASN — Angry Alpaca Sports Network

Hub site for the Angry Alpaca pools. Build plan: `claude/aasn-plan.md` in the AAHL Claude Project.

| Path | What |
|---|---|
| `/` | AASN hub — leagues + Hall of Champions (reads `public.champions`) |
| `/aabl/` | AABL (MLB box pick'em, 2027) — static preview for now |
| `/shared/` | Shared CSS + Supabase config |
| `/sql/` | Database migrations, run in order in the Supabase SQL editor |
| `/workers/` | Cloudflare Worker (saves + nightly jobs) — coming later |

AAHL stays in its own repo (`AAHL-2526`) until after the NHL season.

## Stack (all free tiers)
- GitHub Pages (this repo, `main` branch, root)
- Supabase — same project as AAHL, separate `aabl` schema
- Cloudflare Worker for saves/nightly jobs (later)
- Stats: `statsapi.mlb.com`

## Setup checklist
1. Run `sql/001_aabl_schema.sql` in Supabase → SQL editor.
2. Supabase → Project Settings → API → Exposed schemas → add `aabl`.
3. GitHub → Settings → Pages → Source: `main` / root.

Not linked from anywhere yet; pages carry `noindex`.
