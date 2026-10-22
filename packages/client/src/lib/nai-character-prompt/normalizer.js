import { SHAPE } from './promptRules.js';
export function parseStructured(raw, source) {
  const fail = () => { throw new Error('LLM 결과 형식 또는 원문 근거가 올바르지 않습니다. 다시 생성해주세요.'); };
  let value;
  try { value = JSON.parse(raw); } catch { fail(); }
  function check(v, shape) {
    if (Array.isArray(shape)) {
      if (!Array.isArray(v) || v.length > 100) fail();
      for (const item of v) {
        if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'evidence,value' ||
          typeof item.value !== 'string' || !item.value.trim() || item.value.length > 4000 ||
          typeof item.evidence !== 'string' || !item.evidence.trim() ||
          ![source.description, source.appearance].some(s => s.includes(item.evidence))) fail();
      }
    } else {
      if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).sort().join(',') !== Object.keys(shape).sort().join(',')) fail();
      for (const k of Object.keys(shape)) check(v[k], shape[k]);
    }
  }
  check(value, SHAPE);
  if (value.subject.length > 1 || value.subject.some(x => !['girl', 'boy'].includes(x.value))) fail();
  for (const item of value.text.content) if (!item.evidence.includes(item.value)) fail();
  return value;
}
export function normalize(value) {
  const seen = new Set();
  const key = s => s.toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const collect = (items, used) => items.map(x => x.value.trim().replaceAll('_', ' ').replace(/\s+/g, ' ')).filter(s => {
    const k = key(s); if (used.has(k)) return false; used.add(k); return true;
  });
  const positive = collect([value.subject, value.bodyTypeMajor, value.appearance.hair, value.appearance.eyes,
    value.appearance.skin, value.appearance.bodyTypeMinor, value.attire, value.composition, value.action,
    value.expression, value.text.location, value.text.font, value.text.attributes].flat(), seen);
  const negative = collect(value.negative, new Set());
  if (negative.some(s => seen.has(key(s)))) throw new Error('긍정·마이너스 태그가 충돌합니다. 다시 생성해주세요.');
  const exclusive = [['small breasts', 'medium breasts', 'large breasts', 'huge breasts'], ['open mouth', 'closed mouth'], ['skinny', 'fat']];
  if (exclusive.some(group => group.filter(s => seen.has(s)).length > 1)) throw new Error('서로 모순되는 외형 태그가 생성되었습니다. 다시 생성해주세요.');
  // Lettering is literal, never lowercased, rewritten or split by commas.
  const lettering = [...new Set(value.text.content.map(x => x.value))];
  const prompt = positive.join(', ') + (lettering.length ? `${positive.length ? ', ' : ''}text:(${lettering.join('\n\n')})` : '');
  if (!prompt && !negative.length) throw new Error('원문에서 확실한 시각 정보를 찾지 못했습니다.');
  return { prompt, negative: negative.join(', ') };
}
