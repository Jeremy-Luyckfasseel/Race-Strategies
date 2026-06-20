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
    ob_title: 'Welcome',
    ob_firewall: 'Windows will ask to allow network access — click Allow so we can read your PS5.',
    ob_scanning: 'Looking for your PS5…',
    ob_detected: 'PS5 detected at {ip}',
    ob_none: 'No PS5 found yet — make sure GT7 is running with telemetry enabled.',
    ob_offline: 'Connecting to the telemetry relay…',
    ob_rescan: 'Scan again',
    ob_car_optional: 'Car (optional)',
    ob_car_none: '— none —',
    ob_go: 'Start',
    ob_skip: 'Skip for now',
    si_title: 'Import recorded session',
    si_hint: 'Build your strategy from a session recorded with the recorder. Race length and drivers are kept — only the car model is filled in.',
    si_choose: 'Choose capture(s) (.json)',
    si_driver: 'Driver',
    si_remove: 'Remove',
    si_fuel: 'Fuel',
    si_laps_tank: 'laps/tank',
    si_weight: 'Fuel-weight',
    si_not_separable: 'not separable — using 0.03',
    si_laps: 'laps',
    si_confident: 'confident',
    si_weak: 'weak',
    si_apply: 'Apply to strategy',
    si_applied: 'Applied ✓',
    si_error: "Couldn't read that capture file",
    si_no_model: 'No usable model in this session yet',
    tg_team: 'Team',
    tg_group: 'Group',
    tg_race: 'Race',
    tg_new_group: 'New group',
    tg_new_race: 'New race',
    tg_new: 'New',
    tg_delete: 'Delete',
    tg_pick_folder: 'Pick shared race folder',
    tg_folder: 'Folder',
    tg_refresh: 'Refresh',
    tg_no_sessions: 'No driver sessions yet — pick the shared race folder, or add files.',
    tg_build: 'Build strategy from this race',
    tg_create_group_hint: 'Create a group for your team, add a race, then point it at the shared folder where each driver drops their recorded session.',
    tg_server_url: 'Sync server URL (optional)',
    tg_code: 'Group code',
    tg_pull: 'Pull from group',
    tg_create_remote: 'Create group on server',
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
    ob_title: 'Bienvenue',
    ob_firewall: "Windows va demander l'accès réseau — cliquez Autoriser pour qu'on puisse lire votre PS5.",
    ob_scanning: 'Recherche de votre PS5…',
    ob_detected: 'PS5 détectée à {ip}',
    ob_none: 'Aucune PS5 trouvée — vérifiez que GT7 tourne avec la télémétrie activée.',
    ob_offline: 'Connexion au relais de télémétrie…',
    ob_rescan: 'Relancer la recherche',
    ob_car_optional: 'Voiture (optionnel)',
    ob_car_none: '— aucune —',
    ob_go: 'Démarrer',
    ob_skip: 'Passer pour le moment',
    si_title: 'Importer une session enregistrée',
    si_hint: "Construisez votre stratégie à partir d'une session enregistrée. La durée de course et les pilotes sont conservés — seul le modèle de la voiture est rempli.",
    si_choose: 'Choisir des captures (.json)',
    si_driver: 'Pilote',
    si_remove: 'Retirer',
    si_fuel: 'Carburant',
    si_laps_tank: 'tours/plein',
    si_weight: 'Effet du poids',
    si_not_separable: 'non séparable — 0.03 par défaut',
    si_laps: 'tours',
    si_confident: 'fiable',
    si_weak: 'faible',
    si_apply: 'Appliquer à la stratégie',
    si_applied: 'Appliqué ✓',
    si_error: 'Fichier de capture illisible',
    si_no_model: 'Pas encore de modèle exploitable dans cette session',
    tg_team: 'Équipe',
    tg_group: 'Groupe',
    tg_race: 'Course',
    tg_new_group: 'Nouveau groupe',
    tg_new_race: 'Nouvelle course',
    tg_new: 'Nouveau',
    tg_delete: 'Supprimer',
    tg_pick_folder: 'Choisir le dossier partagé de la course',
    tg_folder: 'Dossier',
    tg_refresh: 'Actualiser',
    tg_no_sessions: 'Pas encore de sessions — choisissez le dossier partagé, ou ajoutez des fichiers.',
    tg_build: 'Calculer la stratégie de cette course',
    tg_create_group_hint: "Créez un groupe pour votre équipe, ajoutez une course, puis pointez-la vers le dossier partagé où chaque pilote dépose sa session enregistrée.",
    tg_server_url: 'URL du serveur de sync (optionnel)',
    tg_code: 'Code du groupe',
    tg_pull: 'Récupérer du groupe',
    tg_create_remote: 'Créer le groupe sur le serveur',
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
