import { francAll } from 'franc-min'
import type { Node as PMNode } from 'prosemirror-model'

const MIN_TEXT_LENGTH = 40
const MIN_SCORE_GAP = 0.1

const FRANC_TO_BCP47 = Object.freeze<Record<string, string>>({
  cmn: 'zh',
  spa: 'es',
  eng: 'en',
  rus: 'ru',
  arb: 'ar',
  ben: 'bn',
  hin: 'hi',
  por: 'pt',
  ind: 'id',
  jpn: 'ja',
  fra: 'fr',
  deu: 'de',
  jav: 'jv',
  kor: 'ko',
  tel: 'te',
  vie: 'vi',
  mar: 'mr',
  ita: 'it',
  tam: 'ta',
  tur: 'tr',
  urd: 'ur',
  guj: 'gu',
  pol: 'pl',
  ukr: 'uk',
  kan: 'kn',
  mai: 'mai',
  mal: 'ml',
  pes: 'fa',
  mya: 'my',
  swh: 'sw',
  sun: 'su',
  ron: 'ro',
  pan: 'pa',
  bho: 'bho',
  amh: 'am',
  hau: 'ha',
  fuv: 'ff',
  bos: 'bs',
  hrv: 'hr',
  nld: 'nl',
  srp: 'sr',
  tha: 'th',
  ckb: 'ckb',
  yor: 'yo',
  uzn: 'uz',
  zlm: 'ms',
  ibo: 'ig',
  npi: 'ne',
  ceb: 'ceb',
  skr: 'skr',
  tgl: 'tl',
  hun: 'hu',
  azj: 'az',
  sin: 'si',
  koi: 'koi',
  ell: 'el',
  ces: 'cs',
  mag: 'mag',
  run: 'rn',
  bel: 'be',
  plt: 'mg',
  qug: 'qu',
  mad: 'mad',
  nya: 'ny',
  zyb: 'za',
  pbu: 'ps',
  kin: 'rw',
  zul: 'zu',
  bul: 'bg',
  swe: 'sv',
  lin: 'ln',
  som: 'so',
  hms: 'hms',
  hnj: 'hmn',
  ilo: 'ilo',
  kaz: 'kk'
})

export function documentText(doc: PMNode | undefined): string {
  return doc?.textBetween(0, doc.content.size, '\n', '\n').replace(/\s+/g, ' ').trim() ?? ''
}

export function detectDocumentLanguage(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < MIN_TEXT_LENGTH) return null

  try {
    const results = francAll(normalized, { minLength: MIN_TEXT_LENGTH })
    const first = results[0]
    const second = results[1]
    if (!first || first[0] === 'und') return null
    if (second && first[1] - second[1] < MIN_SCORE_GAP) return null
    return FRANC_TO_BCP47[first[0]] ?? null
  } catch {
    return null
  }
}
