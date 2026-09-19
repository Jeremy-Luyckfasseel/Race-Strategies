/**
 * Lightweight i18n strings layer.
 *
 * Per CLAUDE.md: "English is primary; wire i18n as a strings file so French +
 * Dutch are added later without a rewrite." `en` is the source of truth and the
 * fallback for any missing key — adding `nl.js` and one entry in `LANGS` is the
 * whole job.
 *
 * `DEFAULT_LANG` stays 'fr': that is what existing users (and the UI tests) see
 * on a machine with nothing stored. The header switch overrides it and persists
 * the choice under `gt7-lang`.
 *
 * Pure — no React. `t(key, lang, vars)` does simple `{name}` interpolation.
 */

import en from './en.js';
import fr from './fr.js';

export const DEFAULT_LANG = 'fr';

/** Switch order = display order in the header toggle. */
export const LANGS = [
  { id: 'fr', label: 'FR' },
  { id: 'en', label: 'EN' },
];

export const LANG_KEY = 'gt7-lang';

const STRINGS = { en, fr };

/** The stored language, or the default when nothing valid is stored. */
export function loadLang(getItem) {
  try {
    const v = getItem(LANG_KEY);
    return STRINGS[v] ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Translate a key. Falls back to English, then to the raw key. Interpolates
 * `{name}` placeholders from `vars`.
 */
export function t(key, lang = DEFAULT_LANG, vars) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  }
  return s;
}

/**
 * Display name for a tyre compound id. The engine works in ids (H/M/S/IM/W) and
 * carries English names for logs and tests; what the screen shows comes from here.
 */
export function compoundName(id, lang = DEFAULT_LANG) {
  return id ? t(`compound_${id}`, lang) : '';
}

/** Short, upper-case compound name for the leaderboard's narrow cells. */
export function compoundShort(id, lang = DEFAULT_LANG) {
  return id ? t(`compound_short_${id}`, lang) : '';
}

/** "Hard -> Soft -> Hard" from the run-length compound sequence of a strategy. */
export function compoundSequence(ids, lang = DEFAULT_LANG) {
  return (ids || []).map((id) => compoundName(id, lang)).join(' → ');
}

export default STRINGS;
