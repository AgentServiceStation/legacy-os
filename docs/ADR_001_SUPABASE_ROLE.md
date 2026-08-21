# ADR-001 — Supabase Role During Legacy OS v1 Development

## Status
Accepted for current development branch.

## Context
The current Legacy OS alpha is a functioning Cloudflare application whose relational persistence is implemented through Drizzle's D1 adapter and a Cloudflare `DB` binding. The repository's environment contract describes Supabase as an optional account/authentication system (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_EMAILS`), not as the current primary persistence adapter.

A founder-controlled Supabase organization and free development project (`legacy-os-dev`, US West) now exist. The Supabase public schema is intentionally empty.

## Decision
Do **not** migrate the Legacy OS operational schema from D1 to Supabase/Postgres simply because a Supabase project now exists.

Use Supabase first for the capabilities it can add without creating two systems of record:

1. Account authentication / identity when we are ready to replace the private-preview boundary.
2. Owner/developer/client identity and account lifecycle.
3. Future auth-backed multi-user workspace access where justified.

The existing D1 database remains the operational system of record during stabilization of the tattoo-first vertical slice.

A migration from D1 to PostgreSQL may be evaluated later only if concrete requirements justify it (scale, query complexity, relational constraints, extensions/vector requirements, operations, multi-tenant needs, or maintainability). Such a migration must be deliberate, tested, reversible, and executed as one authoritative migration—not by duplicating live operational writes into two databases indefinitely.

## Why
- Preserves Nathan's working alpha architecture instead of rewriting it for novelty.
- Avoids split-brain data and synchronization bugs.
- Lets us use the new founder-controlled Supabase account immediately where it provides real value.
- Keeps the path open to PostgreSQL later if Professional Craft Intelligence / search / multi-tenant requirements justify it.

## Current Supabase state
- Organization: Legacy OS
- Project: legacy-os-dev
- Region: US West (`us-west-1`)
- Plan: Free / $0 per month at creation
- Status: ACTIVE_HEALTHY
- Public tables: none at initialization
- Security advisor findings at initialization: none

## Revisit trigger
Revisit this ADR when one of the following becomes true:
- The current D1 schema materially blocks the v1 lifecycle.
- Production multi-tenant/auth requirements cannot be safely satisfied around D1.
- Knowledge/semantic search requires PostgreSQL-specific functionality that is clearly worth migration complexity.
- Operational ownership/deployment requirements make a single Supabase/Postgres system materially safer or simpler.
