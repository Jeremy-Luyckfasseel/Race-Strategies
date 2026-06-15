/**
 * Lightweight i18n strings layer (seeded in Phase 2, Task 2.1).
 *
 * Per CLAUDE.md: "English is primary; wire i18n as a strings file so French +
 * Dutch are added later without a rewrite." `en` is the source of truth and the
 * fallback for any missing key. The rest of the app still has hardcoded French
 * strings (a later extraction job) — so `DEFAULT_LANG` is 'fr' for now to keep the
 * new "Now" view visually consistent with the current UI; flipping the whole app
 * to English is then a one-line change plus filling in `en` everywhere.
 *
 * Pure — no React. `t(key, lang, vars)` does simple `{name}` interpolation.
 */

export const DEFAULT_LANG = 'fr';

const STRINGS = {
  en: {
    now_tab: 'Race',
    now_waiting: 'Waiting for telemetry',
    now_no_plan: 'No strategy yet — set up inputs and calculate',
    now_stint: 'Stint {n}',
    now_laps_left: 'Laps left in stint',
    now_next_action: 'Next action',
    now_box_lap: 'Box lap {lap}',
    now_add_fuel: '+{n} L',
    now_change_tyres: 'new tyres',
    now_keep_tyres: 'keep tyres',
    now_run_to_flag: 'Run to the flag',
    now_box_reason: 'Box: {reason}',
    reason_fuel: 'fuel',
    reason_tyres: 'tyres',
    reason_plan: 'plan',
    now_lift: 'Lift and coast',
    now_push: 'You can push',
    now_on_target: 'On target',
    now_margin: '{n} laps of fuel margin',
    now_freeze: 'Freeze plan',
    now_frozen: 'Plan frozen',
  },
  fr: {
    now_tab: 'Course',
    now_waiting: 'En attente de télémétrie',
    now_no_plan: 'Aucune stratégie — configurez et calculez',
    now_stint: 'Relais {n}',
    now_laps_left: 'Tours restants au relais',
    now_next_action: 'Prochaine action',
    now_box_lap: 'Box tour {lap}',
    now_add_fuel: '+{n} L',
    now_change_tyres: 'pneus neufs',
    now_keep_tyres: 'garder pneus',
    now_run_to_flag: "Jusqu'à l'arrivée",
    now_box_reason: 'Box : {reason}',
    reason_fuel: 'carburant',
    reason_tyres: 'pneus',
    reason_plan: 'plan',
    now_lift: 'Lever et rouler',
    now_push: 'Tu peux pousser',
    now_on_target: 'Dans la cible',
    now_margin: '{n} tours de marge carburant',
    now_freeze: 'Geler le plan',
    now_frozen: 'Plan gelé',
  },
};

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

export default STRINGS;
