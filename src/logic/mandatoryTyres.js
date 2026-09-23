/**
 * Which of the race's must-run tyres a car has not run yet.
 *
 * If the rules say every car has to run mediums and hards at some point, a
 * rival that has only run mediums still owes a stint on hards — the slower
 * tyre, still to come. That is strategy: it says what they must do later, and
 * when.
 *
 * Read from the stint log, which every car on the LAN has, tyre by tyre as
 * they were set. A stint whose tyre was never set could have been any of
 * them, so it is counted, and a car with such stints only "may" owe a tyre.
 *
 * Pure.
 */

/**
 * @param {{history?: Array<{compound: string|null}>, current?: {compound: string|null}|null}|null} entry
 * @param {string[]} mandatoryIds  the compounds the rules make every car run
 * @returns {{owed: string[], unknownStints: number}|null}  null when there is nothing to say
 */
export function tyresOwed(entry, mandatoryIds) {
  if (!entry || !Array.isArray(mandatoryIds) || mandatoryIds.length === 0) return null;
  const stints = [...(entry.history ?? []), ...(entry.current ? [entry.current] : [])];
  if (stints.length === 0) return null;
  const used = new Set(stints.map((s) => s.compound).filter(Boolean));
  const unknownStints = stints.filter((s) => !s.compound).length;
  return { owed: mandatoryIds.filter((id) => !used.has(id)), unknownStints };
}
