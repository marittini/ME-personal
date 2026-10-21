/** Server-captured destination. Never infer it from the currently open UI on replay. */
export type NaiImageDestination =
  | { kind: "npc"; chatId: string; safeName: string; expectedHash: string | null }
  | { kind: "profile"; entity: "character" | "persona"; id: string; expectedAvatarPath: string | null }
  | {
      kind: "chat";
      chatId: string;
      messageId?: string;
      swipeId?: string;
      characterIds?: string[];
      personaIds?: string[];
      generation?: import("../utils/chat-image-generation.js").ChatImageGenerationRecord;
      replacement?: {
        galleryId: string;
        messages: Array<{ id: string; swipeIndex: number; swipeId?: string }>;
        swipes: Array<{ id: string; messageId: string }>;
      };
      provider?: string;
      characterName?: string;
      roleplayCommandIndex?: number;
    };
export type NaiJobState =
  | "QUEUED"
  | "HELD"
  | "RUNNING"
  | "APPLYING"
  | "CONFLICT"
  | "SUCCEEDED"
  | "APPLY_FAILED"
  | "FAILED"
  | "UNKNOWN"
  | "CANCELLED";
export interface NaiQueueJobView {
  id: string;
  groupId: string;
  connectionId: string | null;
  revision: number;
  createdAt: string;
  state: NaiJobState;
  model?: string;
  reason?: string;
  resultUrl: string | null;
  resultPath?: string;
}
export interface NaiQueueStatus {
  storageFailed: boolean;
  groups: Array<{ id: string; automatic: boolean; notBefore: number; reason?: string }>;
  jobs: NaiQueueJobView[];
  total: number;
  hasHeld: boolean;
  hasRunning: boolean;
  appliedRevision: number;
  nextOffset: number | null;
}
