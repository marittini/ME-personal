# Library Shell: Product and Engineering Design

Status: implementation-ready design draft  
Scope: Marinara Engine core UI and server, mobile first

## 1. Product contract

Marinara's ordinary shell should pass as a calm personal ebook library in public. AI-specific controls appear only after a book is opened, and only when they are useful. The shell must preserve every existing chat behavior: generation, editing, swipes, translation, TTS, calls, agents, memories, branches, and connected Conversation/Roleplay chats.

The interface uses whitespace, editorial typography, thin dividers, and a single user-selected accent. It avoids dashboards, card grids, decorative gradients, glow, glass blur, permanent toolbars, and repeated metadata.

## 2. Stable vocabulary

| Reader UI | Engine concept | Notes |
| --- | --- | --- |
| Work / book | `library_works` row | Presentation and grouping only; never owns message content. |
| Author | Primary character name or user override | A group chat may use a custom author label. |
| Volume / reading record | Existing `chat` | One work can contain several chats and branches. |
| Body | `roleplay` chat | Uses the existing Roleplay generation and message path. |
| Letters | `conversation` chat | Uses the existing Conversation and call path. |
| Adventure | `game` chat | Hidden from the quiet default surface; available in the work menu. |
| New passage | Existing durable autonomous unread count | Never infer unread state from timestamps alone. |
| Recent position | New per-chat reading cursor | Message ID plus optional pixel/character offset. |
| Contents | User-created checkpoints and existing branches | No fabricated chapters. |
| Notes | New private reader annotations | Separate from prompt context and Conversation Notes. |
| Highlights | New text-range annotations | Never sent to the model unless the user explicitly does so. |
| Bookmark | New message anchor | Stable message ID and swipe index. |

The UI may localize these labels, but internal API and type names remain explicit and technical.

## 3. Data model

### 3.1 `library_works`

A work is a small presentation record that groups existing chats.

```ts
interface LibraryWork {
  id: string;
  title: string;
  authorLabel: string | null;
  primaryCharacterId: string | null;
  coverAssetId: string | null;
  coverCrop: AvatarCrop | null;
  description: string | null;
  shelfId: string | null;
  sortOrder: number;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Add nullable `libraryWorkId` to `chats`. A work may contain multiple chats, but a chat belongs to at most one work. Messages remain in their current tables.

### 3.2 Shelves

Extend `libraryFolderScopeSchema` with `"works"` and use the existing `library_folders` API. Do not add another folder implementation. A work appears in at most one shelf; the existing move operation remains authoritative.

### 3.3 Reading state

```ts
interface LibraryReadingState {
  chatId: string;
  messageId: string | null;
  swipeIndex: number | null;
  intraMessageOffset: number | null;
  updatedAt: string;
}
```

Store this separately from chat metadata so scroll writes do not reorder chats or rewrite large metadata blobs. Debounce writes after scrolling stops and flush on route exit. Restore by message ID first; use the offset only after the message mounts.

### 3.4 Reader annotations

```ts
interface ReaderAnnotation {
  id: string;
  workId: string;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  kind: "bookmark" | "highlight" | "note" | "checkpoint";
  startOffset: number | null;
  endOffset: number | null;
  selectedText: string | null;
  note: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Offsets target the active swipe content. If that swipe is edited, keep the annotation but mark its range unresolved until the user reanchors it. Bookmarks and checkpoints remain valid because their message anchor is stable.

## 4. Work creation and migration

No existing chat is changed during startup.

1. The library endpoint returns explicit works plus virtual legacy works.
2. A virtual work groups a chat with its `connectedChatId`; otherwise it contains one chat.
3. Its title uses the chat name, its author uses the primary character, and its cover uses the chat background or character image.
4. A virtual work becomes persistent only when the user edits its title, cover, shelf, visibility, or adds another chat.
5. Creating a new chat from a work writes `libraryWorkId` immediately.
6. Deleting a work never deletes chats by default. A separate destructive action can delete the work and its chats with an explicit list.

This lazy migration avoids a blocking pass over large installations and preserves imports and backups.

## 5. Screen architecture

### Home

Show only:

- one `Continue reading` work based on the most recently opened reading state;
- up to three recent works, sorted by `lastMessageAt`;
- shelf shortcuts;
- a discreet new-work action;
- bottom navigation: Home, Library, Record, Settings.

Do not show character tags, AI status, model names, mode badges, or a global mode switch.

### Library

- Work covers are the primary browse unit.
- Search covers title, author label, chat name, character name, and tags through the existing search infrastructure.
- Filters: All, Recent, New passage, Favorites, Hidden.
- Shelves use the existing folder interaction.
- Long press: Move shelf, Work info, Hide, Delete.

Only covers visible in the viewport load images. Use server thumbnails and lazy decoding.

### Work detail

The screen shows title, author, cover, description, contained reading records, characters, annotations, and settings.

The primary action is context dependent:

- existing last-opened chat: `Continue reading`;
- no chat: `Start reading` opens a two-choice sheet;
- both modes exist: small `Body` and `Letters` choices below the main action;
- Game appears in the overflow menu unless it is the last-opened mode.

`New reading` creates a new chat under the same work. It does not overwrite or reset an existing chat.

### Reader: Body

Use the existing Roleplay chat and message IDs. The default state contains only prose, inline media, and the composer. Tapping the latest assistant message reveals its contextual toolbar: Listen, Translate, Edit, swipe position, Regenerate, More. Previous messages expose actions by tap or long press.

The composer remains fixed and keyboard safe. Scene direction and OOC are in the plus menu. Generation state appears as one quiet status line with Cancel.

### Reader: Letters

Use the existing Conversation chat, presence, autonomous messages, calls, and message actions. Calls stay as a one-row bar below the header; the transcript and composer remain usable. No microphone control is introduced.

### Reading settings

Settings are progressive:

1. appearance: theme, font, size, line height, paragraph spacing, margins, alignment, media width;
2. reader behavior: keep composer visible, keep latest reply above keyboard, contextual tool visibility;
3. language and voice: translation display and TTS;
4. advanced generation: link to the existing chat settings drawer.

Reader settings never duplicate provider, prompt, agent, or connection state.

### Record

Default tabs are Recent, Highlights, Notes, Bookmarks. Recent is derived from existing chat activity plus reading state. Highlights, Notes, and Bookmarks appear only when the annotation table contains entries.

## 6. Honest indicators

The following values are prohibited unless backed by real data:

- completion percentage for an open-ended chat;
- page count;
- remaining reading time;
- ratings;
- fabricated chapter count;
- reading-time statistics without an activity tracker.

Use these instead:

- `184 passages` from the existing message-count endpoint;
- `3 new passages` from durable unread state;
- `Last read today at 22:14` from reading state;
- `Body` / `Letters` availability from chats attached to the work;
- `2 / 4` from `activeSwipeIndex` and actual swipe count;
- a thin scroll-position indicator inside a finite, currently loaded transcript only. It is viewport position, never story completion.

Optional reading-time tracking may be added later. It must count only while the reader is visible, the document is visible, and the user has interacted recently. It must stop during generation waits, calls in the background, and idle periods.

## 7. Existing feature connections

| Surface action | Existing implementation path |
| --- | --- |
| Open/continue | `setActiveChatId(chatId)` plus reading cursor restore |
| Latest preview/time | home feed and `lastMessageAt` |
| New passage badge | `unreadCounts` plus durable autonomous unread metadata |
| Send | existing `ChatInput` / `ConversationInput` |
| Stop | current abort controller and `stopGeneration` |
| Edit | existing message edit mutation |
| Regenerate | existing generation hook with message ID |
| Swipe | existing swipe list and `activeSwipeIndex` |
| Translate | existing saved translation flow |
| Listen | existing TTS message action and cache |
| Call | existing active Conversation call snapshot and call tables |
| Branch | existing branch metadata and branch panel |
| Memory/lorebook/agents | existing chat settings, opened through Advanced |
| Search | existing global/chat search, presented with reader terminology |

The library shell imports these actions. It must not reproduce their business logic.

## 8. Visual density rules

- One primary action per screen.
- At most one metadata line under a title.
- At most three recent items on Home.
- No section is wrapped in a card unless it is independently actionable.
- Use dividers and whitespace before containers.
- Minimum touch target 44px; icons may remain visually 20–24px.
- Hide secondary actions until selection, tap, long press, or overflow.
- Body text follows the engine font and user reader settings.
- Accent colors come from semantic theme tokens; the mockup tan is not hard-coded.
- Dark mode uses solid reading surfaces. No blur behind prose.

## 9. Performance constraints

- No DOM-wide MutationObserver.
- No per-row timers. Reuse the existing shared clock for relative time.
- Virtualize long work and record lists.
- Load work summaries in one endpoint; do not issue one request per cover.
- Request thumbnail-sized cover assets and lazy decode offscreen images.
- Persist reading position with a debounced, idempotent write.
- Keep chat components mounted only for the active reader.
- Avoid animated layout and disable decorative motion on mobile and reduced-motion devices.

## 10. API surface

Add focused endpoints:

```text
GET    /api/library/works
POST   /api/library/works
GET    /api/library/works/:id
PATCH  /api/library/works/:id
DELETE /api/library/works/:id
POST   /api/library/works/:id/chats
DELETE /api/library/works/:id/chats/:chatId
GET    /api/library/reading-state/:chatId
PUT    /api/library/reading-state/:chatId
GET    /api/library/works/:id/annotations
POST   /api/library/works/:id/annotations
PATCH  /api/library/annotations/:id
DELETE /api/library/annotations/:id
```

`GET /api/library/works` returns cover thumbnail URLs, contained mode availability, latest chat ID/time, message count, and unread count in one payload.

## 11. Compatibility

- Imports without work metadata appear as virtual works.
- Existing chat routes and deep links continue to work.
- Existing desktop shell remains available during staged rollout.
- Custom themes supply semantic tokens; no reader color or font is hard-coded.
- Backups include the new tables and nullable chat link.
- Removing a work link leaves the chat intact.
- Conversation/Roleplay linking remains authoritative for cross-mode context; work membership does not imply prompt sharing.

## 12. Implementation slices

1. Data and compatibility: work table, chat link, virtual-work query, folders scope, backup/export.
2. Quiet shell: Home, Library, Work detail, navigation, search.
3. Reader integration: wrap existing Roleplay and Conversation surfaces without duplicating actions.
4. Reading state: cursor persistence and resume.
5. Annotations: bookmarks first, then notes/highlights/checkpoints.
6. Privacy polish: terminology audit, recent-app preview masking option, quick neutral screen action.
7. Validation and rollout: mobile keyboard, Android Chrome, mobile WebKit, desktop, light/dark/custom themes, large libraries, long chats, calls, TTS, translation, branches, imports, and backups.

## 13. Acceptance criteria

- A new or legacy chat is reachable without data migration failure.
- Opening a work reaches the same chat ID and message/swipe state as the current UI.
- No outer-shell label reveals AI, character chat, model, prompt, TTS, or Roleplay terminology.
- No progress, page, time, rating, or chapter value is fabricated.
- The latest reply and composer remain visible when the mobile keyboard opens.
- Regenerate, edit, swipe, translation, TTS, calls, branches, memories, lorebooks, and agents retain current behavior.
- A 1,000-work library remains responsive without loading full chat histories or full-size covers.
- Custom font, accent, light/dark mode, reduced motion, and 200% text scaling remain usable.
