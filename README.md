# PMO Hub

A lightweight hub for IT leadership to keep a finger on many projects and major
items at once — without turning into a task tracker.

## Run it

```
npm install          # once; installs the SQL Server driver
npm start            # or: node server.js   (needs Node 18+)
```

Open http://localhost:3000. On first run with no users, the server creates
`admin@example.com` with a random password and prints it in the terminal.
Add or reset users with:

```
node server.js add-user someone@example.com 'a-password' [admin]
```

## Layout

- `public/login.html` — sign-in (always light theme). Replace `public/logo.png` with your logo.
- `public/index.html` — Summary (sidebar + page bar + content).
  The sidebar lists Summary and the Projects / Vendors / Roadmap / Quick Wins tabs; each tab can be expanded to show its entries (click one to open it; the choice of which tabs are open is remembered). Entries have shareable addresses like `/#vendor/<id>`.
- `public/notes.html` — Notes: a month calendar and a day-by-day diary of general notes (not tied to an entry). Each person's notes are private to them; they're saved through the same store as everything else. Days with notes show a dot; each note can record a meeting name (suggested from earlier ones; click a meeting name to see every note for it); there is search across all your notes.
- `public/admin.html` — Administration (admins only). Currently: SAML SSO settings.
- `public/theme.css` — all colours and style tokens (light = Warm Paper, dark = Midnight).

## Login & storage (temporary)

- Users are kept in `data/users.txt` as `email|role|salt|hash` (salted scrypt hashes,
  not plain text). Secure storage is a later stage. `data/` is git-ignored.
- SSO settings are kept in `data/config.json`.
- **Not done yet:** the SAML sign-in flow itself. Administration stores the Entra
  settings and the login page has the SSO button, but it does not sign anyone in yet.
- Project data (entries, notes, pins) is shared: it lives on the server, not in each browser.

## Where project data is stored

Administration → **Data storage** chooses where entries and notes live.

- **Server file** (default): `data/store.json`. Nothing to set up.
- **SQL Server Express**: PMO Hub does not download or install it. The page links to
  Microsoft's download; once it's installed you (1) enter the server, database, SQL login and
  password, (2) *Test connection*, (3) *Create schema* (creates the database if needed, then
  tables under a `pmo` schema; safe to re-run, and it upgrades an older schema in place — Notes added schema version 2 and meeting names version 3, so existing SQL Server users press *Create schema* again after updating), and (4) *Use SQL Server for storage*, optionally
  copying the current data across. You can switch back to the file at any time.
- Express needs **Mixed Mode** authentication (PMO Hub uses a SQL login), **TCP/IP enabled** in
  SQL Server Configuration Manager, and — for a named instance such as `localhost\SQLEXPRESS` —
  the SQL Server Browser service, or use `localhost,port` instead.
- The connection password is kept in plain text in `data/storage.json` for now (same status as
  the user file). Use a dedicated low-privilege login rather than `sa`.
- Saves go to the server a moment after each edit. If the store is unreachable the top bar shows
  "Not saved — retrying" and changes are retried until they go through. Concurrent edits to the
  *same* entry are last-write-wins. Other people's changes appear when you reload or return to the tab.
- First run on a new store: if this browser still holds data from before shared storage existed, you
  are offered a one-time copy into the shared store.
- `npm audit` reports a high-severity advisory in `@azure/msal-node`, pulled in by the SQL driver for
  *Microsoft Entra* sign-in to SQL Server. PMO Hub signs in with a SQL login and never uses that
  code path; the fix needs a major-version bump the driver doesn't yet allow.


## What it does

- **Entries** — *Projects* and *Tracks* (major trackable items such as a vendor
  negotiation). A track can sit under a project.
- **Status icon** — Off track, At risk, On track, On hold, Not started, Done. Each
  has its own shape as well as colour.
- **Where it stands** — one line you can scan in the summary.
- **Detailed notes** — free-form background kept with the entry.
- **Notes log** — dated notes with a label (Update, Decision, Risk, Blocker,
  Action, Question, FYI, or your own). Filter by label inside an entry, or across
  everything from the top bar.
- **Summary view** — status counts (click to filter), search, team/label filters,
  sorting by "needs attention", overdue and "no update in N days" flags.
- **Timeline** — Gantt chart from start/end dates, with today marker; click a bar
  to open the entry.

Deliberately not included: task lists, assignees per task, dependencies, % complete.

## Data

Stored in the browser's `localStorage`. Use **⋯ → Export JSON** to back up or move
between machines, and **Import JSON** to restore. First launch loads sample data
(**⋯ → Delete everything** clears it).
