// User-supplied SharedNAI bridge 0.1.2, direct-call adapter (no global fetch patch).
import { createHash } from "node:crypto";

const NOVELAI_HOST = "image.novelai.net";
const NOVELAI_PATH_SUFFIX = "/ai/generate-image";
const DEFAULT_ORIGIN = "https://sharednai5.pro";
const LOG_PREFIX = "[sharednai-image-bridge]";

export class SharedNaiTranslationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SharedNaiTranslationError";
  }
}

export class SharedNaiUpstreamError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SharedNaiUpstreamError";
    this.status = status;
  }
}

export function parseCredential(credentialString) {
  if (typeof credentialString !== "string") return null;
  if (credentialString.startsWith("sharednai-token:")) {
    const token = credentialString.slice("sharednai-token:".length);
    if (!token) return null;
    return { type: "token", token, raw: credentialString };
  }
  if (credentialString.startsWith("sharednai:")) {
    const rest = credentialString.slice("sharednai:".length);
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    const username = rest.slice(0, sep);
    const password = rest.slice(sep + 1);
    if (!username || !password) return null;
    return { type: "password", username, password, raw: credentialString };
  }
  return null;
}

export function isSharedNaiAuthHeader(headerValue) {
  return typeof headerValue === "string" && /^Bearer\s+sharednai(?:-token)?:/.test(headerValue);
}

export function resolveRequestUrl(resource) {
  if (typeof Request !== "undefined" && resource instanceof Request) return resource.url;
  if (resource instanceof URL) return resource.toString();
  return String(resource);
}

export function isNovelAiGenerateImageUrl(resource) {
  let url;
  try {
    url = new URL(resolveRequestUrl(resource));
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname === NOVELAI_HOST && url.pathname.endsWith(NOVELAI_PATH_SUFFIX);
}

export function readHeaderValue(resource, init, name) {
  const headersSource =
    init && Object.prototype.hasOwnProperty.call(init, "headers") && init.headers !== undefined
      ? init.headers
      : typeof Request !== "undefined" && resource instanceof Request
        ? resource.headers
        : undefined;
  if (!headersSource) return undefined;
  if (typeof Headers !== "undefined" && headersSource instanceof Headers) {
    return headersSource.get(name) ?? undefined;
  }
  if (Array.isArray(headersSource)) {
    const lower = name.toLowerCase();
    const found = headersSource.find(([key]) => String(key).toLowerCase() === lower);
    return found ? found[1] : undefined;
  }
  if (typeof headersSource === "object") {
    const lower = name.toLowerCase();
    const key = Object.keys(headersSource).find((candidate) => candidate.toLowerCase() === lower);
    return key ? headersSource[key] : undefined;
  }
  return undefined;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function validateRange(value, fallback, { label, min, max, integer = false, hint } = {}) {
  const n = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    const rangeDesc = integer ? `${min}~${max} 사이의 정수` : `${min}~${max} 사이의 값`;
    throw new SharedNaiTranslationError(`${label} 값은 ${rangeDesc}여야 합니다.${hint ? ` ${hint}` : ""}`);
  }
  return n;
}

export function randomNovelAiSeed() {
  return Math.floor(Math.random() * 4294967296);
}

function resolveSeed(value) {
  if (value === undefined || value === null) return randomNovelAiSeed();
  const n = Number(value);
  if (Number.isFinite(n) && n < 0) return randomNovelAiSeed();
  if (!Number.isFinite(n) || !Number.isInteger(n) || n > 4294967295) {
    throw new SharedNaiTranslationError("시드(seed) 값은 0~4294967295 사이의 정수여야 합니다.");
  }
  return n;
}

const STEPS_HINT =
  "Marinara는 스텝(Steps) 값을 최대 150까지 허용하지만 SharedNAI는 1~50까지만 지원합니다. 연결의 이미지 설정에서 스텝 값을 낮추세요.";
const SCALE_HINT =
  "Marinara는 가이던스(Guidance/Scale) 값을 최대 30까지 허용하지만 SharedNAI는 0~10까지만 지원합니다. 연결의 이미지 설정에서 가이던스 값을 낮추세요.";

const SUPPORTED_MODEL_IDS = [
  "nai-diffusion-3",
  "nai-diffusion-furry-3",
  "nai-diffusion-4-full",
  "nai-diffusion-4-curated",
  "nai-diffusion-4-5-full",
  "nai-diffusion-4-5-curated",
  "nai-diffusion-5-full",
  "nai-diffusion-5-curated",
];
const SUPPORTED_MODEL_PATTERN =
  /^nai-diffusion-(?:3|furry-3|4-full|4-curated|4-5-full|4-5-curated|5-full|5-curated)$/i;

function normalizeModelId(rawModel) {
  const model = typeof rawModel === "string" && rawModel ? rawModel : "nai-diffusion-4-5-full";
  const normalized = model === "nai-diffusion-4-curated-preview" ? "nai-diffusion-4-curated" : model;
  if (!SUPPORTED_MODEL_PATTERN.test(normalized)) {
    throw new SharedNaiTranslationError(
      `지원하지 않는 모델입니다: ${model}. 지원 모델: ${SUPPORTED_MODEL_IDS.join(", ")}`,
    );
  }
  return normalized;
}

export function isPngBuffer(buffer) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buffer || buffer.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) return false;
  }
  return true;
}

export async function extractMarinaraRequestBody(init) {
  const body = init?.body;
  const directorRefBuffersByName = new Map();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    let bodyJson;
    for (const [name, value] of body.entries()) {
      if (name === "request") {
        const text = typeof value === "string" ? value : await value.text();
        bodyJson = JSON.parse(text);
      } else if (name.startsWith("director_ref_")) {
        const buffer = typeof value === "string" ? Buffer.from(value) : Buffer.from(await value.arrayBuffer());
        directorRefBuffersByName.set(name, buffer);
      }
    }
    if (!bodyJson) throw new Error("multipart request part missing");
    return { bodyJson, directorRefBuffersByName };
  }
  if (typeof body === "string") {
    return { bodyJson: JSON.parse(body), directorRefBuffersByName };
  }
  if (body && typeof body.text === "function") {
    const text = await body.text();
    return { bodyJson: JSON.parse(text), directorRefBuffersByName };
  }
  throw new Error("unsupported NovelAI request body shape");
}

export function translateNovelAiRequest(body, directorRefBuffersByName = new Map()) {
  if (!isRecord(body)) throw new SharedNaiTranslationError("요청 본문이 올바르지 않습니다.");

  const model = normalizeModelId(body.model);
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const v4Prompt = isRecord(parameters.v4_prompt) ? parameters.v4_prompt : {};
  const v4Caption = isRecord(v4Prompt.caption) ? v4Prompt.caption : {};
  const v4NegativePrompt = isRecord(parameters.v4_negative_prompt) ? parameters.v4_negative_prompt : {};
  const v4NegativeCaption = isRecord(v4NegativePrompt.caption) ? v4NegativePrompt.caption : {};

  const prompt =
    typeof body.input === "string" && body.input.trim()
      ? body.input
      : typeof v4Caption.base_caption === "string"
        ? v4Caption.base_caption
        : "";
  if (!prompt || !prompt.trim()) throw new SharedNaiTranslationError("프롬프트가 비어 있습니다.");

  const width = validateRange(parameters.width, undefined, { label: "가로 크기", min: 64, max: 2048, integer: true });
  const height = validateRange(parameters.height, undefined, { label: "세로 크기", min: 64, max: 2048, integer: true });
  if (width % 64 !== 0 || height % 64 !== 0) {
    throw new SharedNaiTranslationError("가로/세로 크기는 64의 배수여야 합니다.");
  }
  if (width * height > 3_145_728) {
    throw new SharedNaiTranslationError("이미지 전체 픽셀 수가 한도(3,145,728)를 초과했습니다.");
  }

  const legacyNegative = typeof parameters.negative_prompt === "string" ? parameters.negative_prompt : "";
  const v4Negative = typeof v4NegativeCaption.base_caption === "string" ? v4NegativeCaption.base_caption : "";
  const prefersV4Caption = !/^nai-diffusion-(?:3|furry-3)$/.test(model);
  const negativePrompt = prefersV4Caption ? v4Negative || legacyNegative : legacyNegative || v4Negative;
  const seed = resolveSeed(parameters.seed);
  const isV5 = /^nai-diffusion-5-/.test(model);

  const posCaptions = Array.isArray(v4Caption.char_captions) ? v4Caption.char_captions : [];
  const negCaptions = Array.isArray(v4NegativeCaption.char_captions) ? v4NegativeCaption.char_captions : [];
  const useCoords = v4Prompt.use_coords === true;
  const characters = posCaptions.map((entry, index) => {
    const center = Array.isArray(entry?.centers) && entry.centers[0] ? entry.centers[0] : { x: 0.5, y: 0.5 };
    return {
      positive_prompt: typeof entry?.char_caption === "string" ? entry.char_caption : "",
      negative_prompt: typeof negCaptions[index]?.char_caption === "string" ? negCaptions[index].char_caption : "",
      center_x: clamp01(center.x, 0.5),
      center_y: clamp01(center.y, 0.5),
      use_custom_position: useCoords,
    };
  });
  const characterLimit = isV5 ? 32 : 6;
  if (characters.length > characterLimit) {
    throw new SharedNaiTranslationError(`캐릭터 수가 모델 한도(${characterLimit}명)를 초과했습니다.`);
  }

  const vibeImages = Array.isArray(parameters.reference_image_multiple) ? parameters.reference_image_multiple : [];
  const vibeInfo = Array.isArray(parameters.reference_information_extracted_multiple)
    ? parameters.reference_information_extracted_multiple
    : [];
  const vibeStrength = Array.isArray(parameters.reference_strength_multiple)
    ? parameters.reference_strength_multiple
    : [];
  const vibe_transfers = vibeImages
    .map((image, index) => (typeof image === "string" && image ? { image, index } : null))
    .filter(Boolean)
    .map(({ image, index }) => ({
      image_base64: image,
      strength: clamp01(vibeStrength[index], 0.6),
      information_extracted: clamp01(vibeInfo[index], 1),
      is_encoded: false,
    }));
  if (vibe_transfers.length > 0 && isV5) {
    throw new SharedNaiTranslationError("V5 모델에서는 Vibe Transfer를 사용할 수 없습니다.");
  }

  const directorImagesInline = Array.isArray(parameters.director_reference_images)
    ? parameters.director_reference_images
    : null;
  const directorImagesCached = Array.isArray(parameters.director_reference_images_cached)
    ? parameters.director_reference_images_cached
    : null;
  const descriptions = Array.isArray(parameters.director_reference_descriptions)
    ? parameters.director_reference_descriptions
    : [];
  const strengthValues = Array.isArray(parameters.director_reference_strength_values)
    ? parameters.director_reference_strength_values
    : [];
  const secondaryStrengthValues = Array.isArray(parameters.director_reference_secondary_strength_values)
    ? parameters.director_reference_secondary_strength_values
    : [];

  const refCount = directorImagesInline?.length ?? directorImagesCached?.length ?? 0;
  const precise_references = [];
  for (let index = 0; index < refCount; index++) {
    let base64;
    if (directorImagesInline) {
      base64 = directorImagesInline[index];
    } else if (directorImagesCached) {
      const partName = directorImagesCached[index]?.data;
      const buffer = partName ? directorRefBuffersByName.get(partName) : undefined;
      base64 = buffer ? buffer.toString("base64") : undefined;
    }
    if (!base64) continue;
    const baseCaption = descriptions[index]?.caption?.base_caption;
    const referenceType = baseCaption === "style" ? "style" : "character_and_style";
    precise_references.push({
      image_base64: base64,
      reference_type: referenceType,
      strength: clamp01(strengthValues[index], 1),
      fidelity: clamp01(1 - numberOr(secondaryStrengthValues[index], 0), 1),
    });
  }
  if (precise_references.length > 0 && !model.includes("-4-5-")) {
    throw new SharedNaiTranslationError("Director Reference(정밀 참조)는 V4.5 모델에서만 사용할 수 있습니다.");
  }
  if (precise_references.length > 0 && vibe_transfers.length > 0) {
    throw new SharedNaiTranslationError("Vibe Transfer와 Director Reference는 동시에 사용할 수 없습니다.");
  }

  return {
    model,
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    steps: validateRange(parameters.steps, 28, { label: "스텝(Steps)", min: 1, max: 50, integer: true, hint: STEPS_HINT }),
    scale: validateRange(parameters.scale, 5, { label: "가이던스(Guidance/Scale)", min: 0, max: 10, hint: SCALE_HINT }),
    seed,
    sampler: typeof parameters.sampler === "string" && parameters.sampler ? parameters.sampler : "k_euler_ancestral",
    schedule:
      typeof parameters.noise_schedule === "string" && parameters.noise_schedule
        ? parameters.noise_schedule
        : "karras",
    cfg_rescale: validateRange(parameters.cfg_rescale, 0, { label: "CFG Rescale", min: 0, max: 1 }),
    sm: parameters.sm === true,
    variety: parameters.variety === true || parameters.variety_boost === true,
    legacy_uc: parameters.legacy_uc === true,
    uc_preset: Number.isInteger(parameters.ucPreset) ? parameters.ucPreset : 2,
    quality_toggle: false,
    n_samples: 1,
    transparent_background: parameters.transparent_background === true,
    model_mode: model.includes("furry") ? "furry" : "anime",
    characters,
    vibe_transfers,
    precise_references,
  };
}

function unknownGenerationResponse(message) {
  const response = textResponse(502, message);
  response.headers.set("x-sharednai-result-unknown", "1");
  return response;
}

function textResponse(status, message) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function koreanErrorMessage(status) {
  const messages = {
    401: "사이트 로그인이 만료되었거나 로그인 정보가 틀립니다. 다시 연결하세요.",
    403: "사이트에서 접근이 거부되었습니다. 계정 상태를 확인하세요.",
    422: "사이트가 생성 설정을 거부했습니다. 모델·해상도·옵션을 확인하세요.",
    425: "사이트 대기열 시간이 초과되었습니다.",
    429: "사이트 사용량 또는 동시 생성 제한입니다. 잠시 후 다시 시도하세요.",
  };
  return messages[status] || `사이트 응답 오류 (HTTP ${status})`;
}

function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  return !!error && (error.name === "NaiRateLimitError" || error.name === "AbortError" || error.name === "TimeoutError" || error.code === "ABORT_ERR");
}

export async function loginPassword(fetchImpl, origin, username, password, signal) {
  let response;
  try {
    response = await fetchImpl(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    throw new SharedNaiUpstreamError(502, "사이트 연결에 실패했거나 시간이 초과되었습니다.");
  }
  if (!response.ok) {
    discardBody(response);
    const mappedStatus = response.status >= 500 ? 502 : response.status;
    throw new SharedNaiUpstreamError(mappedStatus, koreanErrorMessage(mappedStatus));
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    throw new SharedNaiUpstreamError(502, "사이트 로그인 응답을 해석할 수 없습니다.");
  }
  if (!data || typeof data.access_token !== "string" || !data.access_token) {
    throw new SharedNaiUpstreamError(502, "사이트 로그인 응답 형식이 올바르지 않습니다.");
  }
  return data.access_token;
}

async function callGenerate(fetchImpl, origin, token, upstreamBody, signal) {
  return fetchImpl(`${origin}/api/generate/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(upstreamBody),
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
}

async function resolveToken(fetchImpl, credential, origin, tokenCache, signal) {
  if (credential.type === "token") {
    return { key: credential.cacheKey, token: credential.token, canRelogin: false };
  }
  const cached = tokenCache.get(credential.cacheKey);
  if (cached) return { key: credential.cacheKey, token: cached, canRelogin: true };
  const token = await loginPassword(fetchImpl, origin, credential.username, credential.password, signal);
  tokenCache.set(credential.cacheKey, token);
  return { key: credential.cacheKey, token, canRelogin: true };
}

function withMutex(mutexes, key, fn, signal) {
  const previousTail = mutexes.get(key) ?? Promise.resolve();
  const run = previousTail.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {},
  );
  mutexes.set(key, settled);
  settled.finally(() => {
    if (mutexes.get(key) === settled) mutexes.delete(key);
  });

  if (!signal) return run;

  return new Promise((resolve, reject) => {
    let settledOuter = false;
    const onAbort = () => {
      if (settledOuter) return;
      settledOuter = true;
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    run.then(
      (value) => {
        if (settledOuter) return;
        settledOuter = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settledOuter) return;
        settledOuter = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function runGeneration({ fetchImpl, credential, origin, tokenCache, upstreamBody, signal }) {
  let tokenInfo;
  try {
    tokenInfo = await resolveToken(fetchImpl, credential, origin, tokenCache, signal);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    if (error instanceof SharedNaiUpstreamError) return textResponse(error.status, error.message);
    return textResponse(502, "사이트 로그인 중 오류가 발생했습니다.");
  }

  let response;
  try {
    response = await callGenerate(fetchImpl, origin, tokenInfo.token, upstreamBody, signal);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return unknownGenerationResponse( "사이트 연결에 실패했거나 시간이 초과되었습니다.");
  }

  if (response.status === 401 && tokenInfo.canRelogin) {
    discardBody(response);
    tokenCache.delete(tokenInfo.key);
    let retryToken;
    try {
      retryToken = await loginPassword(fetchImpl, origin, credential.username, credential.password, signal);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if (error instanceof SharedNaiUpstreamError) return textResponse(error.status, error.message);
      return unknownGenerationResponse( "재로그인 중 오류가 발생했습니다.");
    }
    tokenCache.set(tokenInfo.key, retryToken);
    tokenInfo = { ...tokenInfo, token: retryToken };
    try {
      response = await callGenerate(fetchImpl, origin, retryToken, upstreamBody, signal);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return unknownGenerationResponse( "사이트 연결에 실패했거나 시간이 초과되었습니다.");
    }
  }

  if (!response.ok) {
    discardBody(response);
    const mappedStatus = response.status >= 500 ? 502 : response.status;
    return textResponse(mappedStatus, koreanErrorMessage(mappedStatus));
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return unknownGenerationResponse( "사이트 응답을 해석할 수 없습니다.");
  }

  const item = Array.isArray(data?.images) ? data.images[0] : undefined;
  let imageBase64 = typeof item?.image_base64 === "string" ? item.image_base64 : undefined;
  if (!imageBase64 && typeof item?.image_url === "string") {
    let url;
    try {
      url = new URL(item.image_url, origin);
    } catch {
      return unknownGenerationResponse( "사이트가 반환한 이미지 주소를 해석할 수 없습니다.");
    }
    if (url.origin !== new URL(origin).origin || url.username || url.password) {
      return unknownGenerationResponse( "사이트 외부 이미지 URL은 지원하지 않습니다.");
    }
    try {
      const imageResponse = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${tokenInfo.token}` },
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
      if (!imageResponse.ok) {
        discardBody(imageResponse);
        return unknownGenerationResponse( "이미지 다운로드에 실패했습니다.");
      }
      imageBase64 = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return unknownGenerationResponse( "이미지 다운로드 중 오류가 발생했습니다.");
    }
  }

  if (!imageBase64) return unknownGenerationResponse( "사이트가 이미지를 반환하지 않았습니다.");

  const raw = imageBase64.replace(/^data:image\/png;base64,/, "");
  let bytes;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    return unknownGenerationResponse( "이미지 데이터를 해석할 수 없습니다.");
  }
  if (!isPngBuffer(bytes)) return unknownGenerationResponse( "사이트가 올바른 PNG 이미지를 반환하지 않았습니다.");

  return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
}

function logRequest(logger, upstreamBody) {
  try {
    logger?.debug?.(
      `${LOG_PREFIX} generate request model=%s size=%dx%d characters=%d vibes=%d refs=%d`,
      upstreamBody.model,
      upstreamBody.width,
      upstreamBody.height,
      upstreamBody.characters.length,
      upstreamBody.vibe_transfers.length,
      upstreamBody.precise_references.length,
    );
  } catch {
  }
}

export async function handleIntercepted({ fetchImpl, init, credential, origin, tokenCache, mutexes, logger }) {
  let parsed;
  try {
    parsed = await extractMarinaraRequestBody(init);
  } catch {
    return textResponse(400, "요청 본문을 해석할 수 없습니다.");
  }

  let upstreamBody;
  try {
    upstreamBody = translateNovelAiRequest(parsed.bodyJson, parsed.directorRefBuffersByName);
  } catch (error) {
    if (error instanceof SharedNaiTranslationError) return textResponse(400, error.message);
    return textResponse(400, "요청을 변환하는 중 오류가 발생했습니다.");
  }

  logRequest(logger, upstreamBody);

  return withMutex(
    mutexes,
    credential.cacheKey,
    () => runGeneration({ fetchImpl, credential, origin, tokenCache, upstreamBody, signal: init?.signal }),
    init?.signal,
  );
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function discardBody(response) {
  try {
    response.body?.cancel().catch(() => {});
  } catch {
  }
}

