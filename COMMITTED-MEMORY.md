# Unified Roleplay memory

Open **Chat Settings → Chat Summary → Unified memory**. Select the reply you want and click **Commit memory** (**기억 정리**). This confirms selected versions of unconfirmed visible messages in the configured source window, never alternate swipes. Settings support all pending messages, the native recent-message window, or an inclusive custom message-number range (up to 500). Already confirmed versions are skipped; changing the window never erases earlier memories. Organization, retrieval and aging then run automatically on the server.

Each confirmed range stores a public story summary, a shorter causal core, facts/promises/events/relationship changes/beliefs, knowledge audiences, source IDs and version fingerprints. The configured native summary model/prompt is reused. No Lumiverse source or database stack is copied.

The native Hide summarized messages setting and recent-message tail determine whether confirmed public ranges are omitted from AI context. Native range, tail normalization and hide-ID calculations are reused. Originals are never hidden persistently or deleted: omission is projected at prompt time only while their summary is valid, so source edits restore raw history. Unconfirmed messages and pinned/target messages are retained, subject to normal context limits. After thirty confirmed message positions, retrieval uses causal cores instead of detailed summaries. Current facts and unresolved promises do not expire because of age. Facts with the same canonical kind/key/knowledge scope update a single stable record rather than accumulating copies. Explicit existing IDs support key reuse; unknown IDs and scope changes are rejected. Historical episodes retain their narrative and source coverage, while the fact itself moves to its newest evidence range with source-version dependencies. Changed evidence invalidates the dependent fact and makes its source ranges available for explicit reconfirmation. Resolved/uncertain values suppress older values. Aging follows conversation progress, not time away.

Retrieval uses Unicode words/character bigrams, current obligations, recency, and optional semantic similarity through the configured vectorizer. Priority selects whole records within a conservative 8,000 UTF-8-byte allowance including section wrappers. Current facts/obligations form one section; selected story episodes form a separate section sorted by ascending conversation position, irrespective of retrieval score. This is transcript order, not inferred in-world calendar chronology. Korean display text may help retrieval but never enters the prompt. Existing main-prompt context fitting still applies. Character-restricted facts are included only if every intended character is allowed; empty audiences are narrator-only. Restricted source batches cannot produce a public summary. Natural-language secret classification still depends on the model.

Edits, swipes, visibility changes and deletions invalidate dependent memory. A persisted message revision prevents old memory reviving when returning to an earlier answer. Processing snapshots only messages present at the click; new arrivals remain unconfirmed. Concurrent/repeated clicks share a job. Successful batches persist; failed or changed-source batches do not advance coverage. After a server restart, interrupted jobs require another click to resume.

The inspector shows stored records, source messages (current versions), and records found verbatim in the latest reply's final prompt. **Peek Prompt** includes all text, including macro transformations. Shared-memory preview uses text matching without calling an embedding provider. English and Korean labels are bundled. Following the reference vault ZIP, the first model response returns canonical source-language fields and matching `summaryKo/coreKo/keyKo/contentKo` Korean display fields together; there is no per-item translation action or second translation request. Korean originals omit the redundant display fields. Missing Korean fields for non-Korean originals reject the batch instead of silently saving an incomplete response. Legacy memories without Korean fields display their originals. Display preference changes only the vault, never prompt text. Original edits discard stale corresponding translations.

This is opt-in for existing Roleplay chats. Native automatic summaries, Advanced Memory, legacy vector writing/access, and old summary/LTM agents are paused while enabled. Prior settings are restored on disable. Existing lorebooks and external extensions are not deleted or migrated. Legacy records are not silently accepted as confirmed evidence; messages hidden by an old summary extension must be deliberately unhidden before reconfirming. Copied/imported rooms must confirm their own message identities.

Storage remains file-native with optional compatible fields and no new runtime dependency.

## Memory vault and one-click control

The summary drawer now opens a native-themed memory vault: Overview, Promises,
Facts & relationships, Story, Recall inspector and Settings. Promises have All, Pending, In progress, Completed and Cancelled subviews. Progress is independent from factual certainty, and completion/cancellation removes an obligation from active recall. Search and state
filters operate on the saved records. A wide drawer uses a list/detail split;
a narrow drawer or phone opens details with a Back control. Sources disclose the
current message version. Invalidated records remain visible for inspection.

Corrections are optional: normal operation still requires only choosing the desired
reply and clicking Commit memory. The movable summary bubble uses the Engine's
existing bubble placement, keyboard movement and saved chat layout. Settings can
hide it. Generation and an active commit disable its action; pending count,
processing indicator and completion/error notifications show its state.

Vault edits use an optimistic revision check and preserve source identity and
knowledge scope. Exclusion preserves source coverage, preventing the next click
from recreating an excluded record. Excluding the newest fact also suppresses its
superseded value. A narrative containing an excluded or corrected fact is omitted
from recall so its original wording cannot bypass the correction. Historical
answer receipts remain a record of what was actually sent before an edit.

Summary resolution preserves explicit override/agent/caller/chat precedence and
finally discovers the global default connection. Non-text providers are skipped.
The Settings connection indicator checks configuration, not remote authentication
or availability; those are checked by the actual provider request. Both native
and unified summaries use the shared resolver. A missing connection fails before
starting a memory job and can be repaired in the vault's Settings tab.

## Response and context limits

Both languages share the native summary maximum-output setting. A provider length
finish splits multi-message batches and retries smaller ranges; a single-message
truncation fails without advancing source coverage. Existing-memory hints are
trimmed before splitting the transcript so a small model can still operate as
its memory grows. Arbitrary malformed responses do not trigger unbounded retries.

The model still determines semantic identity, progress and translation quality.
Only exact scoped identities or a verified existing ID can update a record;
merely similar names are not merged. Source-version dependencies protect against
stale evidence but cannot prove a model's natural-language interpretation.
