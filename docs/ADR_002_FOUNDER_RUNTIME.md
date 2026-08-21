# ADR 002 — Founder-Controlled Jarvis Development Runtime

Status: Accepted for development

## Decision
The founder-controlled Legacy Jarvis development environment runs independently from Nathan's hosted alpha.

- Nathan upstream/reference runtime: OpenAI Sites / Cloudflare Worker + D1 + R2.
- Founder Jarvis development runtime: Vercel + Supabase Auth/Postgres/Storage.
- Stable development URL: https://legacy-os-jarvis-dev.vercel.app
- Supabase project: `legacy-os-dev`.

The two runtimes do not share operational data. Nathan's hosted alpha remains a behavioral/reference baseline. The founder runtime is the active live testing environment for new Legacy Jarvis behavior.

## Why
The founder needs an independently controlled URL that can be used continuously while the product is being rebuilt and expanded. The available connected deployment path can manage Vercel directly, and Supabase provides founder-controlled authentication, relational persistence, RLS, and private object storage.

## Security
The founder runtime uses per-user workspaces and workspace membership. Row Level Security is enabled on all application tables. Private file storage is scoped by workspace path. Supabase security advisors were clean after the foundation/security-helper migrations.

## Current live slice
The founder runtime currently exposes:
- Command Center / deterministic Chief-of-Staff briefing over live data
- Universal Capture inbox
- progressive client identity
- tattoo projects and lifecycle advancement
- private design/reference asset storage with SHA-256 fingerprints
- exact-asset/version approvals
- tattoo session conditions
- financial events (estimate/quote/deposit/payment/refund/tip separated)
- healing/outcome records
- audit events

## Boundary
This environment is a founder development alpha, not a claim that the full Legacy OS North Star is complete. AI model reasoning, automatic entity extraction, external email/calendar/payment execution, full client portal parity, professional craft ingestion/retrieval, content intelligence, and production beta hardening remain future implementation work.

Do not silently synchronize data between Nathan's D1 runtime and the founder Supabase runtime. Any migration or consolidation must be explicit, tested, and one-way at the moment of cutover.