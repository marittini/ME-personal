export interface CommittedMemorySource {
  id: string;
  fingerprint: string;
}
export interface CommittedMemoryFact {
  id: string;
  /**
   * Format 3 adds "state" (a visible, changeable condition such as form, clothes, injury, hunger or location; its
   * change history is injected with witnesses) and "thread" (foreshadowing, an open question or a goal). A
   * promise is a thread whose end condition is a promise; it keeps its own kind so format-2 data reads as-is.
   */
  kind: "fact" | "promise" | "event" | "relationship" | "belief" | "state" | "thread";
  key: string;
  content: string;
  keyKo?: string;
  contentKo?: string;
  status: "current" | "resolved" | "uncertain";
  /** Empty means narrator only. Public knowledge must be explicit. */
  audience: "shared" | string[];
  excluded?: boolean;
  edited?: boolean;
  sourceIds: string[];
  progress?: "pending" | "in_progress" | "completed" | "cancelled";
  keywords?: string[];
  dependencies?: CommittedMemorySource[];
  invalidated?: boolean;
  /** Up to three evidence-checked prior values, used only for earlier generation points. */
  previous?: Array<Omit<CommittedMemoryFact, "previous"> & { turn: number }>;
  /**
   * Format 2: the entity this fact describes and which of its slots (owner, location, state, relationship,
   * preference …). The same entity + attribute is one slot: a new value replaces the current one and the old
   * value moves to `previous`, so memories update instead of multiplying.
   */
  entityId?: string;
  attribute?: string;
  /** "always": every turn (default for promises); "recall": only when the scene calls for it (default otherwise). */
  activation?: "always" | "recall";
  /** Each inner list is one combination: every word must appear for the fact to come up. */
  combos?: string[][];
  /** Characters who explicitly do not know this (shown with the knowledge boundaries). */
  unknownTo?: string[];
  /** Over the per-entity cap of current facts: kept as history, never injected. */
  archived?: boolean;
  /** Threads and promises: what closes them ("when Alice returns the book"). */
  endCondition?: string;
  endConditionKo?: string;
  /** The last update operation that produced this value (format 3). */
  op?: CommittedMemoryOperation;
  /** For resolve/reveal: the quoted transcript text the server verified. */
  evidence?: string;
}
/** How one extracted record changes the memory (format 3). */
export type CommittedMemoryOperation = "add" | "update" | "resolve" | "reveal" | "archive";

/** One verbatim line kept with a scene (checked against its source message). */
export interface CommittedMemoryLine {
  speaker: string;
  to?: string;
  text: string;
  /** Korean display only, for a line in another language. */
  textKo?: string;
  sourceId: string;
}
/** Format 3: one scene inside a committed batch. */
export interface CommittedMemoryScene {
  id: string;
  /** Story time, as the transcript states it ("that night", "three days later"). */
  when?: string;
  where?: string;
  /** Names of who was present. */
  participants: string[];
  event: string;
  eventKo?: string;
  /** Up to three verbatim key lines. */
  lines: CommittedMemoryLine[];
  /** What changed in this scene (states, relationships, attitudes), short. */
  changes: string[];
  changesKo?: string[];
  /** Character IDs who know this scene; "shared" when everyone present saw it. */
  audience: "shared" | string[];
  sourceIds: string[];
  keywords?: string[];
}

/** Format 2: who or what memories are about. Aliases identify; keywords on facts call them up. */
export interface CommittedMemoryEntity {
  id: string;
  name: string;
  aliases: string[];
  kind: "person" | "object" | "place" | "group" | "concept";
  createdAt: string;
  /**
   * Created with a name or alias another entity already uses, without the model naming that entity's ID.
   * Never merged automatically; the user merges it or confirms it is someone else.
   */
  homonymOf?: string[];
}

/** One confirmed change (a committed batch, a tidy-up or a merge) that can be undone while nothing later depends on it. */
export interface CommittedMemoryCommitRecord {
  id: string;
  at: string;
  kind: "commit" | "organize" | "merge";
  /** Batches as they were before the change (removed or modified ones). */
  before: CommittedMemoryBatch[];
  /** Batch IDs this change added. */
  added: string[];
  /** Revisions of the changed batches right after the change; undo needs them unchanged. */
  after: Record<string, string>;
  /** Entities this change modified, as they were before it. */
  entitiesBefore: CommittedMemoryEntity[];
  /** Entity IDs this change created. */
  addedEntities: string[];
  summary: { facts: number; entities: number };
}
export interface CommittedMemoryBatch {
  id: string;
  turn: number;
  createdAt: string;
  sources: CommittedMemorySource[];
  summary: string;
  core: string;
  summaryKo?: string;
  coreKo?: string;
  /** Optional deepest compression, generated alongside the first summary. */
  gist?: string;
  gistKo?: string;
  keywords?: string[];
  facts: CommittedMemoryFact[];
  invalidated?: boolean;
  excluded?: boolean;
  revision?: string;
  /** Identities mentioned by this historical episode, including facts subsequently updated elsewhere. */
  factKeys?: string[];
  /** Format 3 scene records; batches committed before format 3 have none until they are re-committed. */
  scenes?: CommittedMemoryScene[];
}
export interface CommittedMemoryState {
  /**
   * 2 adds entities, activation tiers and the commit log; 3 adds scenes, state/thread kinds and update
   * operations. Older formats are read as-is and upgraded on the next write.
   */
  version: 1 | 2 | 3;
  ownerChatId: string;
  enabled: boolean;
  batches: CommittedMemoryBatch[];
  /** Changes on reset; asynchronous writers must check it before saving. */
  epoch?: string;
  indexEpoch?: string;
  resetAt?: string;
  recall?: CommittedMemoryRecallConfig;
  previousSettings?: {
    automaticSummaryEnabled?: boolean;
    enableMemoryRecall?: boolean;
    advancedMemoryEnabled?: boolean;
    memoryAgentIds: string[];
  };
  job?: {
    id: string;
    status: "running" | "complete" | "failed" | "cancelled";
    completed: number;
    total: number;
    error?: string;
  };
  entities?: CommittedMemoryEntity[];
  /** Newest last; the last 20 are kept. */
  commits?: CommittedMemoryCommitRecord[];
  /** The format-1 original, kept once when the memory is first written as format 2. */
  legacyBackup?: unknown;
  /** Stored batches that could not be read: kept untouched and written back as they were. */
  quarantine?: unknown[];
}
export interface CommittedMemorySelection {
  id: string;
  content: string;
  /** Cached display text only; never serialized into the prompt. */
  displayKo?: string;
  stage?: "short" | "long" | "core";
  reason: "recent" | "relevant" | "current";
  sourceIds: string[];
  /**
   * always / recall (facts), state (the scene now), thread (open threads), scene (recalled scenes) or flow
   * (episodes); missing on receipts saved before format 2.
   */
  tier?: "always" | "recall" | "flow" | "boundary" | "state" | "thread" | "scene";
  /** The fact kind, for facts (format 3). */
  kind?: CommittedMemoryFact["kind"];
  tokens?: number;
}
/** What the status response carries of a change: enough to list it and undo it by ID. */
export type CommittedMemoryCommitSummary = Pick<CommittedMemoryCommitRecord, "id" | "at" | "kind" | "summary">;
export interface CommittedMemoryStatus {
  /**
   * The memory without its heavy internals: change history is listed without the snapshots it restores from, and
   * the one-time format-1 backup and set-aside records stay on the server.
   */
  state: Omit<CommittedMemoryState, "commits" | "legacyBackup" | "quarantine"> & {
    commits?: CommittedMemoryCommitSummary[];
  };
  pending: number;
  selectedPending?: number;
  /** Of the selected messages, how many the next commit takes: in "pending" mode only full batches. */
  ready?: number;
  batchSize?: number;
  totalMessages?: number;
  selectionError?: string;
  lastReceipt: { messageId: string; items: CommittedMemorySelection[] } | null;
  /** Format-2 counts for the overview. */
  counts?: {
    entities: number;
    currentFacts: number;
    historyFacts: number;
    homonyms: number;
    duplicateSuspects: number;
    /** "Always" facts left out by the always budget (kept, shown, never deleted). */
    waiting: number;
  };
  /** Malformed stored batches kept untouched; the rest of the memory still works. */
  quarantined?: number;
  /** The stored memory could not be read at all; nothing is written until it is fixed or reset. */
  unreadable?: boolean;
}

/** Optional vault corrections never alter source identity or knowledge scope. */
export interface CommittedMemoryEdit {
  batchId: string;
  factId?: string;
  expectedRevision: string;
  content?: string;
  summary?: string;
  core?: string;
  excluded?: boolean;
  status?: CommittedMemoryFact["status"];
  progress?: NonNullable<CommittedMemoryFact["progress"]>;
  activation?: NonNullable<CommittedMemoryFact["activation"]>;
  keywords?: string[];
  combos?: string[][];
}
export interface CommittedMemoryConnectionStatus {
  ok: boolean;
  connectionId?: string;
  model?: string;
  source?: string;
  error?: string;
  warnings: string[];
}

export interface CommittedMemoryCommitOptions {
  batchSize?: number;
  sourceMode?: "pending" | "last" | "range";
  contextSize?: number;
  rangeStartIndex?: number;
  rangeEndIndex?: number;
}

/** Missing fields preserve legacy retrieval behavior. Token counts use the native Unicode estimator. */
export interface CommittedMemoryRecallConfig {
  /** One token budget for everything injected per turn (default 2400). */
  tokenBudget?: number;
  /** Budget inside it for "always" facts (default 600); the rest wait, never deleted. */
  alwaysTokens?: number;
  /** At most this many "recall" facts per turn (default 12). */
  recallLimit?: number;
  recentMessages?: number;
  longTermMessages?: number;
  topK?: number;
  semanticEnabled?: boolean;
}
