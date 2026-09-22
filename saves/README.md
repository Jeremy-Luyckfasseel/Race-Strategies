# saves/

Where race snapshots live, so they are not scattered through Downloads.

**SAVE** in the app header writes a `race-YYYY-MM-DD-HHMM.json` to wherever your
browser downloads; move it in here. **RESTORE** opens a file picker — point it at
one of these. The app does not read this folder by itself; it is a convention,
not a feature.

## The .json files are NOT committed

`.gitignore` excludes them. **This repository is public**, and a snapshot
contains things that should not be:

- **Driver names** — real people.
- **The PS5's LAN address.**
- **The race setup** — per-compound tyre lives and lap times. If you are racing
  other teams, that is the one file of yours they would most like to read.

To move a save between machines, carry the file: a cloud drive, a USB stick, or
an email to yourself. Not through this repo.

## Full save vs. setup-only

A full **SAVE** carries the whole session: the setup, the race clock, team names
and colours, tyre selections, the stint log, safety-car roles, the PS5 list, the
recorded circuit map, and everything the learner has measured.

That is right for moving a race **in progress** between machines, and for keeping
a record afterwards. It is the wrong thing to carry to a **new event**: you would
arrive with a race clock that started days ago, a circuit map of the last track,
and a learner full of measurements from a different car — all of it presented as
though it belonged to this race.

For a new event, export the setup alone. Paste into the browser console:

```js
(() => {
  const data = {};
  for (const k of ['gt7-inputs', 'gt7-ps5-ips']) if (localStorage[k]) data[k] = localStorage[k];
  const snap = { app: 'race-strategies', schema: 1, savedAt: new Date().toISOString(), data };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }));
  a.download = 'setup-only.json';
  a.click();
  return Object.keys(data);
})()
```

`applySnapshot` only writes the keys a file actually contains, so RESTORE accepts
a partial snapshot and leaves everything else alone. That is what makes a
setup-only export work: your tank, laps per tank, compound lives, lap times,
drivers and PS5 address come back, and nothing else does.
