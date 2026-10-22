import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
const data = await mkdtemp(join(os.tmpdir(), "me-nai-webp-"));
process.env.DATA_DIR = data;
process.env.FILE_STORAGE_DIR = join(data, "storage");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.IMAGE_LOCAL_URLS_ENABLED = "true";
const originalInterfaces = os.networkInterfaces;
os.networkInterfaces = () => ({});
syncBuiltinESMExports();
const { NaiRequestGuard, NaiRateLimitError, NaiGuardError, NaiOutputConversionError, setNaiRequestGuard } =
  await import("../../packages/server/src/services/image/nai-request-guard.js");
const { toStoredWebp, migrateStoredPngs, webpPngTextChunks, DEFAULT_STORED_WEBP_QUALITY } =
  await import("../../packages/server/src/services/image/webp-storage.js");
const { getSharp } = await import("../../packages/server/src/services/image/sharp-runtime.js");
const { generateImage } = await import("../../packages/server/src/services/image/image-generation.js");
const { parseCredential, translateNovelAiRequest } =
  await import("../../packages/server/src/assets/sharednai-bridge.mjs");
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(test: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (test()) return;
    await tick();
  }
  throw new Error("Timed out");
}
try {
  const sharp = await getSharp();
  const png = await sharp({
    create: { width: 24, height: 18, channels: 4, background: { r: 20, g: 80, b: 150, alpha: 0.4 } },
  })
    .png()
    .toBuffer();
  const webp = await toStoredWebp(png);
  assert.equal(webp.ext, "webp");
  assert.equal(DEFAULT_STORED_WEBP_QUALITY, 95);
  assert.deepEqual(
    webp.buffer,
    await sharp(png).keepMetadata().webp({ quality: 95, alphaQuality: 100, effort: 3 }).toBuffer(),
    "default conversion uses quality 95",
  );
  assert.deepEqual(
    await sharp(webp.buffer).extractChannel("alpha").raw().toBuffer(),
    await sharp(png).extractChannel("alpha").raw().toBuffer(),
    "transparency is retained exactly",
  );
  assert.equal((await toStoredWebp(webp.buffer)).buffer, webp.buffer, "existing WebP is not recompressed");
  await mkdir(join(data, "avatars"));
  await writeFile(join(data, "avatars", "old.png"), png);
  assert.equal((await migrateStoredPngs(data)).converted, 1);
  assert.equal((await readFile(join(data, "avatars", "old.png"))).toString("ascii", 8, 12), "WEBP");
  assert.equal((await migrateStoredPngs(data)).converted, 0, "idempotent migration");
  await writeFile(join(data, "avatars", "broken.png"), "broken");
  await migrateStoredPngs(data);
  assert.equal(await readFile(join(data, "avatars", "broken.png"), "utf8"), "broken");
  let guard: InstanceType<typeof NaiRequestGuard>;
  let sent = 0;
  let active = 0;
  let maximum = 0;
  let inject429 = true;
  const order: string[] = [];
  const render = async (prompt: string) => {
    sent++;
    active++;
    maximum = Math.max(maximum, active);
    order.push(prompt);
    await tick();
    active--;
    if (sent === 3 && inject429) {
      guard.rateLimited(null);
      throw new NaiRateLimitError(null);
    }
    return { base64: webp.buffer.toString("base64"), ext: "webp", mimeType: "image/webp" };
  };
  const options = {
    directory: join(data, "queue"),
    identify: (key: string) => key,
    connectionForKey: async (key: string) => key,
    keyForConnection: async (id: string) => id,
    delay: () => 1,
    replay: async (job: { request: { prompt: string } }) => render(job.request.prompt),
  };
  guard = new NaiRequestGuard(options);
  const submit = (prompt: string, key = "account-a") =>
    guard.submit({
      source: "novelai",
      baseUrl: "https://image.novelai.net",
      serviceHint: "novelai",
      apiKey: key,
      request: { prompt },
      task: () => render(prompt),
    });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => submit(String(i + 1))));
  assert.equal(maximum, 1);
  assert.equal(sent, 3);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(guard.list().jobs.filter((j) => j.state === "HELD").length, 8, "429 task is retained too");
  assert.ok(
    results
      .filter((r) => r.status === "rejected")
      .every((r) => r.status === "rejected" && r.reason instanceof NaiGuardError),
  );
  assert.ok(!(await readFile(join(data, "queue", "queue.json"), "utf8")).includes('"apiKey"'));
  inject429 = false;
  const held = guard.list().jobs.filter((j) => j.state === "HELD");
  guard.run([{ id: held[4].id, revision: held[4].revision }]);
  await until(() => guard.detail(held[4].id)?.state === "SUCCEEDED");
  assert.equal(order.at(-1), "7");
  await assert.rejects(submit("new-held"), NaiGuardError);
  assert.equal(sent, 4);
  const selected = guard
    .list()
    .jobs.filter((j) => j.state === "HELD")
    .slice(0, 2);
  guard.run(selected.map(({ id, revision }) => ({ id, revision })));
  await until(() => selected.every((j) => guard.detail(j.id)?.state === "SUCCEEDED"));
  assert.deepEqual(order.slice(-2), ["3", "4"]);
  assert.throws(() => guard.run(selected.map(({ id, revision }) => ({ id, revision }))), "stale run rejected");
  const cancelled = guard.list().jobs.find((j) => j.state === "HELD")!;
  guard.cancel([{ id: cancelled.id, revision: cancelled.revision }]);
  assert.equal(guard.detail(cancelled.id)?.state, "CANCELLED");
  await submit("other", "account-b");
  assert.equal(order.at(-1), "other");
  guard.close();
  const legacySnapshot = JSON.parse(await readFile(join(data, "queue", "queue.json"), "utf8"));
  const legacyIdle = legacySnapshot.groups.find((group: { id: string }) => group.id === "account-b");
  legacyIdle.automatic = false;
  legacyIdle.reason = "restart";
  legacySnapshot.groups.push({ id: "interrupted-account", automatic: true, notBefore: 0 });
  legacySnapshot.jobs.push({
    id: "00000000-0000-4000-8000-000000000001",
    groupId: "interrupted-account",
    connectionId: "interrupted-account",
    revision: 1,
    createdAt: new Date().toISOString(),
    state: "QUEUED",
    source: "novelai",
    baseUrl: "https://image.novelai.net",
    serviceHint: "novelai",
    request: { prompt: "never replay without approval" },
    attempt: 0,
  });
  await writeFile(join(data, "queue", "queue.json"), JSON.stringify(legacySnapshot));
  guard = new NaiRequestGuard(options);
  const before = sent;
  await tick();
  assert.equal(sent, before);
  assert.equal(guard.detail("00000000-0000-4000-8000-000000000001")?.state, "HELD");
  assert.equal(guard.list().groups.find((g) => g.id === "account-a")?.automatic, false, "manual holds survive restart");
  assert.equal(guard.list().groups.find((g) => g.id === "account-b")?.automatic, true, "idle accounts stay available");
  await submit("fresh request after restart", "account-b");
  assert.equal(sent, before + 1, "new explicit work on a clean account runs without resuming old jobs");
  assert.equal(guard.detail(cancelled.id)?.state, "CANCELLED");
  guard.close();
  const conversionGuard = new NaiRequestGuard({ ...options, directory: join(data, "conversion") });
  await assert.rejects(
    conversionGuard.submit({
      source: "novelai",
      baseUrl: "https://image.novelai.net",
      serviceHint: "novelai",
      apiKey: "account-c",
      request: { prompt: "already paid" },
      task: async () => {
        throw new NaiOutputConversionError({ base64: png.toString("base64"), ext: "png", mimeType: "image/png" });
      },
    }),
    NaiGuardError,
  );
  const conversionJob = conversionGuard.list().jobs[0];
  assert.equal(conversionJob.state, "APPLY_FAILED");
  const sentBeforeConversion = sent;
  await conversionGuard.retryConversion(conversionJob.id, conversionJob.revision);
  assert.equal(conversionGuard.detail(conversionJob.id)?.state, "SUCCEEDED");
  assert.equal(sent, sentBeforeConversion, "conversion retry never generates again");
  conversionGuard.close();
  assert.equal(parseCredential("official-key"), null);
  assert.equal(parseCredential("sharednai:user:pass:word")?.password, "pass:word");
  const translated = translateNovelAiRequest({
    input: "exact prompt",
    model: "nai-diffusion-4-5-full",
    parameters: { width: 1024, height: 1024, steps: 28, scale: 5, seed: 123 },
  });
  assert.equal(translated.prompt, "exact prompt");
  assert.equal(translated.seed, 123);

  const originalFetch = globalThis.fetch;
  let physical = 0;
  try {
    globalThis.fetch = async (_resource, init) => {
      physical++;
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.input, "exact prompt");
      assert.equal(payload.parameters.seed, 123);
      if (physical === 3)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("broken error body"));
            },
          }),
          { status: 429, headers: { "retry-after": "30" } },
        );
      return new Response(png, { headers: { "content-type": "image/png" } });
    };
    guard = new NaiRequestGuard({
      directory: join(data, "native"),
      identify: (key) => key,
      connectionForKey: async () => "native-conn",
      keyForConnection: async () => "fixture-key",
      delay: () => 1,
      replay: (job, key, signal) =>
        generateImage(job.source, job.baseUrl, key, job.serviceHint, { ...job.request, signal }),
    });
    setNaiRequestGuard(guard);
    const native = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        generateImage("novelai", "https://image.novelai.net", "fixture-key", "novelai", {
          prompt: "exact prompt",
          allowLocalUrls: true,
          model: "nai-diffusion-4-5-full",
          imageDefaults: { version: 1, service: "novelai", seed: 123 },
          fallback: {
            source: "openai",
            baseUrl: "https://example.org/v1",
            apiKey: "must-not-send",
            serviceHint: "openai",
            model: "dall-e-3",
            connectionId: "other",
            connectionName: "other",
            provider: "openai",
          },
        }),
      ),
    );
    assert.equal(physical, 3, "header-only 429 prevents retry/fallback/fourth dispatch");
    assert.equal(native.filter((r) => r.status === "fulfilled").length, 2);
    const first = native[0];
    assert.ok(first.status === "fulfilled");
    assert.equal(first.value.ext, "webp");
    assert.ok(
      webpPngTextChunks(Buffer.from(first.value.base64, "base64")).includes(Buffer.from("marinara_novelai_request")),
    );
    const heldNative = guard.list().jobs.find((j) => j.state === "HELD")!;
    assert.throws(() => guard.run([{ id: heldNative.id, revision: heldNative.revision }]), /Retry-After/);
    guard.close();
    let sharedRequests = 0;
    globalThis.fetch = async (resource, init) => {
      const url = String(resource);
      if (url.endsWith("/api/auth/login"))
        return new Response(JSON.stringify({ access_token: "fixture-shared-token" }), {
          headers: { "content-type": "application/json" },
        });
      assert.ok(url.endsWith("/api/generate/txt2img"));
      sharedRequests++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt, "exact prompt");
      assert.equal(body.seed, 123);
      if (sharedRequests === 2) throw new TypeError("connection lost after submission");
      return new Response(JSON.stringify({ images: [{ image_base64: png.toString("base64") }] }), {
        headers: { "content-type": "application/json" },
      });
    };
    const sharedKey = "sharednai:fixture-user:fixture-password";
    guard = new NaiRequestGuard({
      directory: join(data, "shared"),
      identify: (key) => key,
      connectionForKey: async () => "shared-conn",
      keyForConnection: async () => sharedKey,
      delay: () => 1,
      replay: (job, key, signal) =>
        generateImage(job.source, job.baseUrl, key, job.serviceHint, { ...job.request, signal }),
    });
    setNaiRequestGuard(guard);
    const sharedRequest = {
      prompt: "exact prompt",
      model: "nai-diffusion-4-5-full",
      width: 1024,
      height: 1024,
      imageDefaults: { version: 1 as const, service: "novelai" as const, seed: 123 },
    };
    const sharedImage = await generateImage(
      "novelai",
      "https://image.novelai.net",
      sharedKey,
      "novelai",
      sharedRequest,
    );
    assert.equal(sharedImage.ext, "webp");
    await assert.rejects(
      generateImage("novelai", "https://image.novelai.net", sharedKey, "novelai", {
        ...sharedRequest,
        fallback: {
          source: "openai",
          baseUrl: "https://example.org/v1",
          apiKey: "must-not-send",
          serviceHint: "openai",
          model: "dall-e-3",
          connectionId: "other",
          connectionName: "other",
          provider: "openai",
        },
      }),
      NaiGuardError,
    );
    assert.equal(sharedRequests, 2, "SharedNAI response loss never triggers fallback");
    assert.equal(guard.list().jobs.filter((job) => job.state === "UNKNOWN").length, 1);
    guard.close();
  } finally {
    globalThis.fetch = originalFetch;
    setNaiRequestGuard(undefined);
  }
  console.log(
    "NAI/WebP regression passed: serialization, gap scheduling, 429 holds, manual run, cancel, restart, isolation, pixels, old URLs, SharedNAI translation, exact native payload, header-first 429 and no fallback",
  );
} finally {
  os.networkInterfaces = originalInterfaces;
  syncBuiltinESMExports();
  await rm(data, { recursive: true, force: true });
}
