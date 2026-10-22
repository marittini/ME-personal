# Unified memory follow-up

Owner request: reset existing unified memory, persistent vectors, keyword recall,
progressive detail reduction, bulk Korean display completion, and a quieter vault.
Original chat messages, source evidence, audience restrictions, one-click confirmation,
and original-language-only prompt injection must remain intact.

## Implementation and proof checklist

- Reset confirmed unified records, bounded fact history, display fields, index and receipts;
  preserve chat text/settings and fence in-flight jobs. Optional JSON backup before reset.
- Persist content/evidence/scope/model-addressed vectors, prune stale entries, reuse unchanged
  vectors and fall back to lexical matching on provider failure.
- Extract source/Korean keywords and aliases in the first summary response. Hybrid ranking,
  duplicate removal, episode limit, ascending chronology and configurable budget.
- Short summary / long core / deepest gist selection without deleting saved evidence.
  Current facts and unresolved promises remain eligible regardless of age.
- Bulk enrich already confirmed records without rewriting canonical content or IDs.
- Collapse source and diagnostic details by default. Keep useful content/status visible.

## Remaining verification and follow-ups

- Live-provider translation, extraction and multilingual embedding quality remain model-dependent.
- Actual desktop/mobile and light/dark visual proof is blocked by browser installation;
  focused Playwright assertions cover collapsed source details but are not claimed as run.
- Native Unicode token estimates are supported. Provider-exact tokenization remains open.
- Detail tiers select pre-generated representations. Repeated LLM consolidation across
  episodes and arbitrary historical state restoration are not implemented.
- Snapshot export is available; a dedicated snapshot import/restore UI remains open.
- Full prompt suite is blocked by its existing missing storyboard-episode import and
  TSX Unix IPC restriction. Local CodeRabbit CLI is unavailable.

## Proof boundary

New recall regression exercises reset/cancel while provider work is in flight,
reset during vectorization, multilingual keyword/gist selection, original-only
prompt text, scoped vectorization, persistent reuse, one-document invalidation,
same-dimensional model changes, provider failure, limits, malformed display IDs,
reset preservation and chat-deletion cleanup. The synthetic provider adds a 40ms
embedding delay: cold/warm times are fixture measurements, not production latency.
Repeated document embedding count drops from two cold documents to zero with the
persisted index. Existing memory and native summary regressions remain required.


## Output and grouping follow-up

- Model lifecycle aliases in fact status must normalize only when unambiguous;
  certainty and knowledge-scope/source validation remain authoritative.
- Malformed JSON/schema output gets one same-transcript regeneration attempt,
  without repairing or saving incomplete content. Repeated failure leaves coverage pending.
- Summary range and messages-per-summary are separate controls. Vault and floating
  action share persisted grouping; explicit request grouping wins, followed by the
  unified setting, existing native summaryContextSize, then the legacy 20 default.
- Requests may use 1–500 messages per group. Token/context/output limits still
  split oversized groups. Source-reference validation supports the larger group.
