/**
 * Team panel (session-import): the in-app home for team race prep.
 *
 * Name a GROUP (your team) → add RACES → per race, point at the shared folder
 * (Dropbox/Drive) where each driver drops their recorded session, and the app reads
 * everyone's captures automatically. Then build the strategy from that race. The
 * structure persists locally (useGroups); the shared folder is the file transport.
 *
 * Cross-machine "share by default" = a synced folder everyone points at. Full
 * folder auto-read needs the File System Access API (Chromium / the desktop app);
 * everywhere else, multi-file add is the fallback. No server, no accounts.
 */

import { useState } from 'react';
import { analyzeCapture } from '../logic/sessionAnalysis';
import { ensureRace, fetchSessions, createGroup as createRemoteGroup } from '../logic/syncClient';
import { useGroups } from '../hooks/useGroups';
import { t } from '../i18n/strings';

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const supportsFolder = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/** Drop the bulky per-lap array before storing (the folder keeps the raw files). */
function slim(a) {
  const { laps, ...rest } = a;
  void laps;
  return rest;
}

function sessionFromCapture(cap, fileName) {
  if (!cap || !Array.isArray(cap.laps) || cap.laps.length === 0) return null;
  const a = analyzeCapture(cap);
  const driver = a.meta?.driver || a.meta?.team || fileName.replace(/\.json$/i, '');
  return { id: `${fileName}-${a.counts.totalLaps}`, fileName, driver, analysis: slim(a) };
}

async function readFolder(dirHandle) {
  const out = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
    try {
      const file = await entry.getFile();
      const s = sessionFromCapture(JSON.parse(await file.text()), entry.name);
      if (s) out.push(s);
    } catch {
      /* skip unreadable / non-capture file */
    }
  }
  return out;
}

export default function TeamPanel({ onBuild, lang }) {
  const grp = useGroups();
  const { state, activeGroup, activeRace } = grp;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const updateSessions = (sessions) => grp.setRaceSessions(activeGroup.id, activeRace.id, sessions);

  const sync = activeGroup?.sync || {};
  const setSync = (patch) => grp.setGroupSync(activeGroup.id, { ...sync, ...patch });
  const canPull = !!(sync.serverUrl && sync.code && activeRace);

  // Create the group ON the server and capture its join code (no curl needed).
  const createOnServer = async () => {
    if (!sync.serverUrl) return;
    setErr(null);
    setBusy(true);
    try {
      const g = await createRemoteGroup(sync.serverUrl, activeGroup.name);
      setSync({ code: g.code });
    } catch (e) {
      setErr(`sync: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Pull every driver's uploaded session for this race from the team sync server.
  const pullFromGroup = async () => {
    if (!canPull) return;
    setErr(null);
    setBusy(true);
    try {
      const race = await ensureRace(sync.serverUrl, sync.code, activeRace.name);
      const remote = await fetchSessions(sync.serverUrl, sync.code, race.id);
      updateSessions(
        remote.map((r) => {
          const a = analyzeCapture(r.capture);
          return { id: `sync-${r.driver}`, fileName: `${r.driver} (sync)`, driver: r.driver || a.meta?.driver || 'Driver', analysis: slim(a) };
        })
      );
    } catch (e) {
      setErr(`sync: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    try {
      setBusy(true);
      const dir = await window.showDirectoryPicker();
      const sessions = await readFolder(dir);
      updateSessions(sessions);
      grp.setRaceFolder(activeGroup.id, activeRace.id, dir.name);
    } catch {
      /* user cancelled */
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => {
              try {
                resolve(sessionFromCapture(JSON.parse(String(r.result)), f.name));
              } catch {
                resolve(null);
              }
            };
            r.readAsText(f);
          })
      )
    ).then((loaded) => updateSessions([...activeRace.sessions, ...loaded.filter(Boolean)]));
  };

  const setDriver = (sid, name) => updateSessions(activeRace.sessions.map((s) => (s.id === sid ? { ...s, driver: name } : s)));
  const removeSession = (sid) => updateSessions(activeRace.sessions.filter((s) => s.id !== sid));

  const build = () => {
    if (activeRace?.sessions?.length) onBuild(activeRace.sessions.map((s) => ({ driver: s.driver, analysis: s.analysis })));
  };

  return (
    <div className="team-panel">
      <div className="tg-head">{t('tg_team', lang)}</div>

      {/* Group selector */}
      <div className="tg-row">
        <select className="tg-select" value={state.activeGroupId || ''} onChange={(e) => grp.setActiveGroup(e.target.value)}>
          {state.groups.length === 0 && <option value="">—</option>}
          {state.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button className="tg-btn" onClick={() => grp.createGroup(t('tg_new_group', lang))} title={t('tg_new', lang)}>
          ＋ {t('tg_group', lang)}
        </button>
      </div>

      {!activeGroup ? (
        <p className="tg-hint">{t('tg_create_group_hint', lang)}</p>
      ) : (
        <>
          <div className="tg-row">
            <input className="tg-name" value={activeGroup.name} onChange={(e) => grp.renameGroup(activeGroup.id, e.target.value)} />
            <button className="tg-btn tg-btn--ghost" onClick={() => grp.deleteGroup(activeGroup.id)} title={t('tg_delete', lang)}>
              ×
            </button>
          </div>

          {/* Optional: connect this group to a sync server (no shared folder needed) */}
          <div className="tg-sync">
            <input
              className="tg-sync-input"
              placeholder={t('tg_server_url', lang)}
              value={sync.serverUrl || ''}
              onChange={(e) => setSync({ serverUrl: e.target.value })}
            />
            <input
              className="tg-sync-input"
              placeholder={t('tg_code', lang)}
              value={sync.code || ''}
              onChange={(e) => setSync({ code: e.target.value })}
            />
            {sync.serverUrl && !sync.code && (
              <button className="tg-btn" onClick={createOnServer} disabled={busy}>
                {t('tg_create_remote', lang)}
              </button>
            )}
          </div>

          {/* Race selector */}
          <div className="tg-row">
            <select className="tg-select" value={state.activeRaceId || ''} onChange={(e) => grp.setActiveRace(e.target.value)}>
              {activeGroup.races.length === 0 && <option value="">—</option>}
              {activeGroup.races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button className="tg-btn" onClick={() => grp.addRace(activeGroup.id, t('tg_new_race', lang))} title={t('tg_new', lang)}>
              ＋ {t('tg_race', lang)}
            </button>
          </div>

          {activeRace && (
            <>
              <div className="tg-row">
                <input className="tg-name" value={activeRace.name} onChange={(e) => grp.renameRace(activeGroup.id, activeRace.id, e.target.value)} />
                <button className="tg-btn tg-btn--ghost" onClick={() => grp.deleteRace(activeGroup.id, activeRace.id)} title={t('tg_delete', lang)}>
                  ×
                </button>
              </div>

              {/* Shared folder + file fallback */}
              <div className="tg-sources">
                {canPull && (
                  <button className="tg-folder-btn" onClick={pullFromGroup} disabled={busy}>
                    {t('tg_pull', lang)}
                  </button>
                )}
                {supportsFolder && (
                  <button className="tg-folder-btn" onClick={pickFolder} disabled={busy}>
                    {activeRace.folderName ? `${t('tg_refresh', lang)} · ${activeRace.folderName}` : t('tg_pick_folder', lang)}
                  </button>
                )}
                <label className="si-file">
                  <input type="file" accept=".json,application/json" multiple onChange={addFiles} />
                  <span>{t('si_choose', lang)}</span>
                </label>
              </div>
              {err && <div className="si-error">{err}</div>}

              {/* Driver sessions */}
              {activeRace.sessions.length === 0 ? (
                <p className="tg-hint">{t('tg_no_sessions', lang)}</p>
              ) : (
                <div className="si-summary">
                  {activeRace.sessions.map((s) => (
                    <div key={s.id} className="si-session">
                      <div className="si-session-top">
                        <input className="si-driver-name" value={s.driver} onChange={(e) => setDriver(s.id, e.target.value)} />
                        <button className="si-remove" onClick={() => removeSession(s.id)} title={t('si_remove', lang)}>
                          ×
                        </button>
                      </div>
                      <div className="si-session-line">
                        {s.analysis.fuel.value != null
                          ? `${round1(s.analysis.fuel.value)} L · ${round1(s.analysis.fuel.lapsPerFullTank)} ${t('si_laps_tank', lang)}`
                          : '—'}
                        {s.analysis.fuelWeight.identifiable ? ` · ${s.analysis.fuelWeight.sPerLiter.toFixed(3)} s/L` : ''}
                      </div>
                      {s.analysis.compounds.filter((c) => c.deg && c.observed).map((c) => (
                        <div className="si-session-line si-compound" key={c.id}>
                          <span className={`si-cmp compound-${c.id}`}>{c.name}</span>
                          <span className="si-times">
                            {c.observed.start} / {c.observed.half} / {c.observed.end}
                            <span className="si-meta">
                              {c.observedLife} {t('si_laps', lang)} ·{' '}
                              <span className={c.confident ? 'si-ok' : 'si-warnish'}>{c.confident ? t('si_confident', lang) : t('si_weak', lang)}</span>
                            </span>
                          </span>
                        </div>
                      ))}
                      {s.analysis.warnings.map((w, i) => (
                        <div key={i} className={`si-warn si-warn--${w.level}`}>{w.msg}</div>
                      ))}
                    </div>
                  ))}
                  <button className="si-apply" onClick={build}>
                    {t('tg_build', lang)}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
