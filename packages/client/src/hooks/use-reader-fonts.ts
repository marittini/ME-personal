import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
/** Reuse the engine font catalog and the font faces registered by App. */
export function useReaderFonts() {
  return useQuery<{ family: string }[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: Infinity,
  });
}
