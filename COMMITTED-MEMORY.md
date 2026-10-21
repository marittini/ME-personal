# Unified Roleplay memory

Open **Chat Settings → Chat Summary → Unified memory**. Select the reply you want and click **Commit memory** (**기억 정리**). This confirms selected versions of unconfirmed visible messages, never alternate swipes. Organization, retrieval and aging then run automatically on the server.

Each confirmed range stores a public story summary, a shorter causal core, facts/promises/events/relationship changes/beliefs, knowledge audiences, source IDs and version fingerprints. The configured native summary model/prompt is reused. No Lumiverse source or database stack is copied.

The latest ten messages and unconfirmed messages remain raw context, subject to existing context limits. Older confirmed public ranges may be omitted from the prompt without hiding or deleting originals. After thirty confirmed message positions, retrieval uses causal cores instead of detailed summaries. Current facts and unresolved promises do not expire because of age. Later resolved/uncertain entries with the same key suppress previous values. Aging follows conversation progress, not time away.

Retrieval uses Unicode words/character bigrams, current obligations, recency, and optional semantic similarity through the configured vectorizer. Whole records fit a conservative 8,000 UTF-8-byte allowance. Existing main-prompt context fitting still applies. Character-restricted facts are included only if every intended character is allowed; empty audiences are narrator-only. Restricted source batches cannot produce a public summary. Natural-language secret classification still depends on the model.

Edits, swipes, visibility changes and deletions invalidate dependent memory. A persisted message revision prevents old memory reviving when returning to an earlier answer. Processing snapshots only messages present at the click; new arrivals remain unconfirmed. Concurrent/repeated clicks share a job. Successful batches persist; failed or changed-source batches do not advance coverage. After a server restart, interrupted jobs require another click to resume.

The inspector shows stored records, source messages (current versions), and records found verbatim in the latest reply's final prompt. **Peek Prompt** includes all text, including macro transformations. Shared-memory preview uses text matching without calling an embedding provider. English and Korean labels are bundled; authored content retains its language.

This is opt-in for existing Roleplay chats. Native automatic summaries, Advanced Memory, legacy vector writing/access, and old summary/LTM agents are paused while enabled. Prior settings are restored on disable. Existing lorebooks and external extensions are not deleted or migrated. Legacy records are not silently accepted as confirmed evidence; messages hidden by an old summary extension must be deliberately unhidden before reconfirming. Copied/imported rooms must confirm their own message identities.

Storage remains file-native with optional compatible fields and no new runtime dependency.
