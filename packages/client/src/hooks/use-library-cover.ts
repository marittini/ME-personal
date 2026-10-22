import { useMutation } from "@tanstack/react-query";
import { libraryCoverSchema } from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export function useUploadLibraryCover() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return libraryCoverSchema.parse(await api.upload("/avatars/library-cover", form));
    },
  });
}
