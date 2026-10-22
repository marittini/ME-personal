import { useUIStore } from "../stores/ui.store";
import { libraryChatGroupKey } from "../lib/library-chat-group";
/** Library aliases never change speaker identity, card exports, search metadata or prompt input. */
export function useLibraryCardDisplay(
  card: { id: string; name: string; title?: string | null; summary: string },
  kind: "characters" | "personas",
) {
  const key = libraryChatGroupKey({ id: "", characterIds: [card.id] });
  const custom = useUIStore((state) => (kind === "characters" ? state.libraryCustomizations[key] : undefined));
  return {
    name: custom?.displayName.trim() || card.name,
    title: custom?.title.trim() || card.title,
    summary: custom?.description.trim() || card.summary,
  };
}
