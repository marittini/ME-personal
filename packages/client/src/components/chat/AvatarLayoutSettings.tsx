// ──────────────────────────────────────────────
// Chat Settings → Agents → Avatars: arrange, size and frame the chat's 2D and 3D avatars
// ──────────────────────────────────────────────
// The Expression Engine's sprite layout controls, for avatars. Arrange turns dragging on and off on the stage
// (which has no controls of its own); the size and framing apply to the picked avatar. Layouts are saved per chat
// on this device, next to the sprites' layout.

// ──────────────────────────────────────────────
// Chat Settings → Agents → Avatars: arrange, size and frame the chat's 2D and 3D avatars
// ──────────────────────────────────────────────
// The Expression Engine's sprite layout controls, for avatars. Arrange turns dragging on and off on the stage
// (which has no controls of its own); the size and framing apply to the picked avatar. Layouts are saved per chat
// on this device, next to the sprites' layout.
// ──────────────────────────────────────────────
// Chat Settings → Agents → Avatars: arrange, size and frame the chat's 2D and 3D avatars
// ──────────────────────────────────────────────
// The Expression Engine's sprite layout controls, for avatars. Arrange turns dragging on and off on the stage
// (which has no controls of its own); the size and framing apply to the picked avatar. Layouts are saved per chat
// on this device, next to the sprites' layout.
// ──────────────────────────────────────────────
// Chat Settings → Agents → Avatars: arrange, size and frame the chat's 2D and 3D avatars
// ──────────────────────────────────────────────
// The Expression Engine's sprite layout controls, for avatars. Arrange turns dragging on and off on the stage
// (which has no controls of its own); the size and framing apply to the picked avatar. Layouts are saved per chat
// on this device, next to the sprites' layout.
import { type AvatarFraming } from "../../features/avatars/contract";
import type { StageAvatarSummary } from "../../features/avatars/stage/avatar-stage-logic";

export interface AvatarLayoutControls {
  /** The avatars the chat's stage shows. */
  avatars: readonly StageAvatarSummary[];
  /** Each shown avatar's size (1 is 100%), by owner id. */
  scales: Readonly<Record<string, number>>;
  /** Each 3D avatar's framing, by owner id (portrait when unset). */
  framings: Readonly<Record<string, AvatarFraming>>;
  /** An avatar has a saved position. */
  hasPlacements: boolean;
  arranging: boolean;
  onToggleArrange: () => void;
  onScaleChange: (ownerId: string, scale: number) => void;
  onFramingChange: (ownerId: string, framing: AvatarFraming) => void;
  onResetPlacements: () => void;
}
