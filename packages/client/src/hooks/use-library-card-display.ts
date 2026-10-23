import { useUIStore } from "../stores/ui.store";
import { libraryChatGroupKey } from "../lib/library-chat-group";

/** Persona display labels are edited in the persona editor and stored under their own key. */
export function personaLibraryKey(personaId: string) {
  return `persona:${personaId}`;
}

/** Library aliases never change speaker identity, card exports, search metadata or prompt input. */
export function useLibraryCardDisplay(
  card: { id: string; name: string; title?: string | null; summary: string },
  kind: "characters" | "personas",
) {
  const key =
    kind === "characters" ? libraryChatGroupKey({ id: "", characterIds: [card.id] }) : personaLibraryKey(card.id);
  const custom = useUIStore((state) => state.libraryCustomizations[key]);
  return {
    name: custom?.displayName.trim() || card.name,
    title: custom?.title.trim() || card.title,
    summary: custom?.description.trim() || card.summary,
  };
}
