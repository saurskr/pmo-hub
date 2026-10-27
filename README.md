# PMO Hub

A lightweight hub for IT leadership to keep a finger on many projects and major
items at once — without turning into a task tracker.

## Run it

```
npm start            # or: node server.js   (needs Node 18+, no other dependencies)
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
- `public/admin.html` — Administration (admins only). Currently: SAML SSO settings.
- `public/theme.css` — all colours and style tokens (light = Warm Paper, dark = Midnight).

## Login & storage (temporary)

- Users are kept in `data/users.txt` as `email|role|salt|hash` (salted scrypt hashes,
  not plain text). Secure storage is a later stage. `data/` is git-ignored.
- SSO settings are kept in `data/config.json`.
- **Not done yet:** the SAML sign-in flow itself. Administration stores the Entra
  settings and the login page has the SSO button, but it does not sign anyone in yet.
- Project data is still stored per-browser (see below), not per user or on the server.

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
