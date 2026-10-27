# PMO Hub

A lightweight hub for IT leadership to keep a finger on many projects and major
items at once — without turning into a task tracker.

Open `index.html` in a browser. No build step, no server, no dependencies.

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
