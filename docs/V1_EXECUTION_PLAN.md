# Legacy OS v1 — Execution Program

This plan converts the Founder North Star into an implementation sequence. It is not a promise that every future vision feature ships in the first release. It defines the shortest path to a complete, trustworthy tattoo-first operating system that can then expand.

## Track 0 — Safety, integrity, and baseline
Goal: make the current alpha safe enough to use with real Legacy Lines data.

- Idempotent create/update actions and double-submit protection.
- Duplicate cleanup/merge/archive tools.
- Explicit test/sandbox flagging and exclusion from analytics/learning.
- Internal/private vs client-visible field boundaries enforced by schema/API.
- Owner/developer/client role separation.
- File/asset visibility rules.
- Exact artifact/version-bound approvals.
- Stable audit events and correlation IDs.
- CI/build/test baseline on the development branch.

Exit: one synthetic project survives these controls cleanly.

## Track 1 — Complete tattoo lifecycle
Goal: one real project survives the complete business/craft loop.

- Flexible client identity: display name, preferred name, optional legal name/contact channels/social handles.
- Candidate project extraction from inquiry/capture.
- Project lifecycle and status transitions.
- References and typed assets.
- Design versions and approval lineage.
- Appointment/session preparation.
- Session record and technique/equipment capture.
- Financial states: estimate, quote, deposit due/paid, balance, payment, refund/tip where appropriate.
- Healing/touch-up records.
- Content eligibility and project-linked content outputs.
- Outcome and lessons captured at completion.

Exit: one real Legacy Lines tattoo completes the entire loop without re-entering the same information across modules.

## Track 2 — Universal Capture + entity routing
Goal: move from form-first operation to 'tell Legacy what happened.'

- Unified capture API and UI for typed text, pasted text, uploaded file/image, quick note, and voice/transcript input.
- Extraction into candidate entities/updates with provenance.
- Entity resolution against existing clients/projects.
- Confidence, ambiguity, and missing-information handling.
- Preview/confirm for consequential or ambiguous changes.
- Automatic low-risk internal structuring when policy allows.

Exit: a messy inquiry or working list can produce proposed clients/projects/tasks without manual duplication.

## Track 3 — Chief of Staff + orchestration
Goal: make Legacy proactively coordinate the operation.

- Shared operational state across clients/projects/calendar/approvals/finance/content/knowledge.
- Priority scoring grounded in commitments, deadlines, revenue, blockers, preparation, and owner goals.
- Work-order abstraction for internal tasks.
- Specialist capability routing behind one Chief of Staff interface.
- Tool/capability registry.
- Approval-policy evaluation before external side effects.
- Execution verification, retries, failure escalation, and audit.
- Morning brief, session preparation, project review, and follow-up flows.

Exit: Chief of Staff can answer 'What should I work on?' and prepare the chosen work using current source-of-truth data.

## Track 4 — Professional Craft Intelligence
Goal: turn education + experience + outcomes into contextual tattoo intelligence.

- Source/provenance model for private courses, mentor guidance, books/notes, personal observations, and AI inference.
- Rights/access metadata so private educational material is not redistributed.
- Ingestion pipeline for text/transcript/images and later video frame extraction.
- Structured tattoo knowledge: technique, equipment, condition, action, reasoning, warning, style, workflow stage, outcome.
- Preserve disagreement between sources.
- Contextual retrieval by project/client/equipment/placement/style.
- Experience loop connecting session conditions to fresh/healed outcomes.
- Confidence that distinguishes sourced fact, mentor method, personal observation, pattern, and inference.

Exit: project/session preparation can retrieve relevant authorized knowledge and clearly distinguish evidence from inference.

## Track 5 — Knowledge Brain + search/graph
Goal: make accumulated creative work queryable and relational.

- Canonical taxonomy/synonym normalization.
- Knowledge entities/edges for client, project, design, reference, session, equipment, technique, content, result, lesson, source.
- Universal search across structured data and authorized content.
- Provenance-aware knowledge item detail.
- Graph APIs before graph visualization polish.
- Pattern/outcome logic that only learns from new meaningful evidence.

Exit: a query such as 'angel' finds related projects, designs, references, sessions, techniques, lessons, content, and outcomes with traceable relationships.

## Track 6 — Content Intelligence
Goal: capture content opportunities before they disappear and connect performance to business outcomes.

- Project-specific content opportunities and shot lists before sessions.
- Typed content assets and rights/client-consent eligibility.
- Content briefs, hooks, captions, edit/story structure, publishing readiness.
- Performance ingestion where APIs permit.
- Attribution model: content → profile/DM/inquiry/project/revenue when evidence exists.
- Distinguish collaboration/mentor amplification from organic distribution where known.

Exit: a project can generate a planned content package and record measurable outcomes without treating views as revenue.

## Track 7 — External connectors
Goal: give Legacy safe hands.

Prioritize connectors that directly reduce Joshua's work:
1. Email/Gmail
2. Calendar
3. Stripe/payment state
4. Storage/files
5. AI model provider abstraction
6. Instagram/Meta data where permissions allow
7. SMS/business messaging if needed
8. Search/research

Each connector must expose bounded capabilities, required scopes, approval class, audit behavior, error handling, and health state.

Exit: at least email/calendar/payment-state workflows operate safely through the policy/approval layer.

## Track 8 — Mobile-first product experience
Goal: make the OS usable during actual tattoo life, not only at a desktop.

- Universal Capture reachable in one action.
- Dashboard/Chief of Staff optimized for phone.
- Client and Project workspaces responsive and fast.
- Image/design previews and version comparison usable on iPhone.
- Session capture optimized for minimal taps/voice.
- Notifications deep-link into the exact unresolved item.
- Search anywhere.

Exit: Joshua can run core daily operation from iPhone without needing desktop recovery steps.

## Track 9 — Production hardening and beta
Goal: move from private alpha to dependable product.

- Auth/account ownership under founder-controlled services.
- Backup/restore rehearsal.
- Migration discipline.
- Rate limiting and abuse protection where applicable.
- Security review of portal tokens, uploads, roles, side effects, and secrets.
- Performance/load testing.
- Error monitoring and operational dashboards.
- Beta onboarding, account/workspace separation, and user data isolation.
- Legal/privacy/payment requirements before public commercialization.

Exit: controlled external beta can be operated without relying on Nathan's personal environment.

## Parallelization
Tracks 0–3 are critical path. Tracks 4–6 can begin in parallel once the data/provenance model is stable. Track 7 can be integrated incrementally as orchestration boundaries stabilize. Track 8 is continuous. Track 9 begins early for ownership/security and finishes after the vertical slice is proven.

## Founder workload rule
Joshua should provide only what cannot be inferred or performed safely by the engineering system: product/creative decisions, real account authorization/credentials through secure provider setup, real client/business rules, and actual human craft outcomes. Research, architecture, coding, test-writing, documentation, QA planning, schema/API work, and most implementation should be handled by the build process rather than turned into founder homework.