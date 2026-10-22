export interface CommittedMemorySource {
  id: string;
  fingerprint: string;
}
export interface CommittedMemoryFact {
  id: string;
  kind: "fact" | "promise" | "event" | "relationship" | "belief";
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
  dependencies?: CommittedMemorySource[];
  invalidated?: boolean;
  /** Up to three evidence-checked prior values, used only for earlier generation points. */
  previous?: Array<Omit<CommittedMemoryFact, "previous"> & { turn: number }>;
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
  facts: CommittedMemoryFact[];
  invalidated?: boolean;
  excluded?: boolean;
  revision?: string;
  /** Identities mentioned by this historical episode, including facts subsequently updated elsewhere. */
  factKeys?: string[];
}
export interface CommittedMemoryState {
  version: 1;
  ownerChatId: string;
  enabled: boolean;
  batches: CommittedMemoryBatch[];
  previousSettings?: {
    automaticSummaryEnabled?: boolean;
    enableMemoryRecall?: boolean;
    advancedMemoryEnabled?: boolean;
    memoryAgentIds: string[];
  };
  job?: { id: string; status: "running" | "complete" | "failed"; completed: number; total: number; error?: string };
}
export interface CommittedMemorySelection {
  id: string;
  content: string;
  /** Cached display text only; never serialized into the prompt. */
  displayKo?: string;
  reason: "recent" | "relevant" | "current";
  sourceIds: string[];
}
export interface CommittedMemoryStatus {
  state: CommittedMemoryState;
  pending: number;
  selectedPending?: number;
  totalMessages?: number;
  selectionError?: string;
  lastReceipt: { messageId: string; items: CommittedMemorySelection[] } | null;
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
  sourceMode?: "pending" | "last" | "range";
  contextSize?: number;
  rangeStartIndex?: number;
  rangeEndIndex?: number;
}
