export interface CommittedMemorySource { id: string; fingerprint: string }
export interface CommittedMemoryFact {
  id: string;
  kind: "fact" | "promise" | "event" | "relationship" | "belief";
  key: string;
  content: string;
  status: "current" | "resolved" | "uncertain";
  /** Empty means narrator only. Public knowledge must be explicit. */
  audience: "shared" | string[];
  sourceIds: string[];
}
export interface CommittedMemoryBatch {
  id: string;
  turn: number;
  createdAt: string;
  sources: CommittedMemorySource[];
  summary: string;
  core: string;
  facts: CommittedMemoryFact[];
  invalidated?: boolean;
}
export interface CommittedMemoryState {
  version: 1;
  ownerChatId: string;
  enabled: boolean;
  batches: CommittedMemoryBatch[];
  job?: { id: string; status: "running" | "complete" | "failed"; completed: number; total: number; error?: string };
}
export interface CommittedMemorySelection {
  id: string;
  content: string;
  reason: "recent" | "relevant" | "current";
  sourceIds: string[];
}
export interface CommittedMemoryStatus {
  state: CommittedMemoryState;
  pending: number;
  lastReceipt: {messageId: string; items: CommittedMemorySelection[]} | null;
}
