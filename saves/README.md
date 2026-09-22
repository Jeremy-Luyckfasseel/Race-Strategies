# saves/

Where race snapshots live, so they are not scattered through Downloads.

**SAVE** in the app header writes a `race-YYYY-MM-DD-HHMM.json` here (or to
wherever your browser downloads — move it in). **RESTORE** opens a file picker;
point it at one of these. The app does not read this folder by itself, it is a
convention, not a feature.

## The .json files are deliberately NOT committed

`.gitignore` excludes them, because **this repository is public** and a snapshot
contains things that should not be:

- **Driver names** — real people.
- **Your PS5's LAN address.**
- **Your race setup** — tyre lives and lap times. If you are racing other teams,
  that is the one file of yours they would most like to read.

To move a save between machines, carry the file (cloud drive, USB). If you would
rather it travelled with the repo, make the repo private first — then remove the
ignore rule below.

## Full save vs. setup-only

A full **SAVE** carries the whole session: the setup, the race clock, team names
and colours, tyre selections, the stint log, safety-car roles, the PS5 list, the
recorded circuit map and everything the learner has measured.

That is right for moving a race **in progress** between machines, or for keeping
a record afterwards. It is the wrong thing to carry to a NEW event: you would
arrive with a race clock that started days ago, a circuit map of the last track,
and a learner full of measurements from a different car.

For a new event, export the setup alone — paste into the browser console:

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
a partial snapshot and leaves everything else alone.
