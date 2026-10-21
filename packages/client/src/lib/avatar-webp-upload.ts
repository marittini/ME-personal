/** Convert still profile photos before upload. GIF/APNG remain frame-aware server work. */
export async function prepareAvatarUpload(path: string, body: unknown): Promise<unknown> {
  const isAvatar = /^\/characters\/(?:personas\/)?[^/]+\/avatar$/.test(path) || /^\/avatars\/npc\/[^/]+$/.test(path);
  const isImage = /^\/(?:agents|connections|prompts|lorebooks)\/[^/]+\/image$/.test(path);
  if ((!isAvatar && !isImage) || !body || typeof body !== "object") return body;
  const field = isAvatar ? "avatar" : "image";
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== "string" || /^data:image\/(?:gif|webp);/i.test(value)) return body;
  const source = value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
  if (/^data:image\/png;/i.test(source)) {
    const data = atob(source.slice(source.indexOf(",") + 1));
    for (let offset = 8; offset + 12 <= data.length;) {
      const length =
        (data.charCodeAt(offset) * 16777216 +
          (data.charCodeAt(offset + 1) << 16) +
          (data.charCodeAt(offset + 2) << 8) +
          data.charCodeAt(offset + 3)) >>>
        0;
      if (data.slice(offset + 4, offset + 8) === "acTL") return body;
      offset += length + 12;
    }
  }
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image conversion unavailable");
  context.drawImage(image, 0, 0);
  const encoded = canvas.toDataURL("image/webp", 0.98);
  canvas.width = 0;
  canvas.height = 0;
  return encoded.startsWith("data:image/webp;") ? { ...body, [field]: encoded, filename: "image.webp" } : body;
}
