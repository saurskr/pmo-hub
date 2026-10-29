# PMO Hub (serverless edition)

A lightweight hub for IT leadership to keep a finger on many projects and major
items at once — without turning into a task tracker.

This branch has **no server, no database and no sign-in**. It is plain HTML/CSS/JS that
runs in your browser and keeps its data there. (The Node server + SQL Server Express
edition lives on `main`.)

## Run it

Serve the `public/` folder with any static web server, then open the address it prints.
The simplest ones:

```
python3 -m http.server 8000 --directory public      # then open http://localhost:8000
# or
npx serve public
```

Use `http://localhost` (or any `https://` host such as GitHub Pages / Azure Static Web Apps).
Browsers only allow the backup-file feature in a secure context. Opening `index.html`
straight from the disk also shows your data, but without the backup file.

## Where your data lives

- **In the browser** (IndexedDB), per browser and per address. Entries, pins, labels and Notes.
  Clearing the site's data removes them — keep a backup.
- **Backup file (Settings → Backup file)** — Chrome or Edge. Pick a file, for example in your
  OneDrive folder, and every change is also written there. On another device choose
  *Use an existing file* to carry on from it. If the browser asks for permission again,
  press *Allow access again*; changes are kept in the browser meanwhile.
- **Download / Restore (Settings)** — one JSON file with everything, works in any browser.
- The Summary page's *Export JSON* covers entries only; Settings → Download backup also includes Notes.

There is a single local user, so Notes are simply yours; there is no login or Administration page.

## Files

- `public/index.html`, `app.js` — Summary (sidebar, Focus, list, Gantt, entry drawer)
- `public/notes.html`, `notes.js` — Notes: calendar and diary with meeting names
- `public/settings.html`, `settings.js` — backup file, download / restore
- `public/local-api.js` — the data layer (IndexedDB + validation); same calls the server used to answer
- `public/file-sync.js` — optional backup-file mirror (File System Access API)
- `public/theme.css` — colours (light = Warm Paper, dark = Midnight)
