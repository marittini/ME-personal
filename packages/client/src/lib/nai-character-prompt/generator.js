import { SHAPE, RULES } from './promptRules.js';
import { parseStructured, normalize } from './normalizer.js';
export async function generatePrompt(adapter, connectionId, source, signal) {
  if (!source.description.trim() && !source.appearance.trim()) throw new Error('선택한 대상의 Description과 Appearance가 모두 비어 있습니다.');
  const data = { description: source.description, appearance: source.appearance };
  const system = { role: 'system', content: RULES + '\nJSON shape: ' + JSON.stringify(SHAPE) };
  const first = await adapter.generate(connectionId, [system, { role: 'user', content: JSON.stringify({ source: data }) }], signal);
  signal?.throwIfAborted();
  const draft = parseStructured(first, data);
  const refined = await adapter.generate(connectionId, [system, { role: 'user', content: JSON.stringify({
    task: 'Audit this draft against the ORIGINAL source. Remove invented, nonvisual, duplicate or conflicting facts. Correct category and within-category order. Prefer Danbooru-style English tags only where exact meaning matches; keep precise English natural language when no suitable tag fits. Do not claim any external validation of tags. Return the same evidence-bearing JSON schema.',
    source: data, draft
  }) }], signal);
  signal?.throwIfAborted();
  return normalize(parseStructured(refined, data));
}
