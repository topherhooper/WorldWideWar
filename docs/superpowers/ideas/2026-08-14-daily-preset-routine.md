# Daily Game Preset Routine — Idea

Date: 2026-08-14
Status: Captured — not yet brainstormed
Source: own notes, dictated to /one-shot

## Raw dump

I'm going to create a claude daily routine where we create a new game preset every day.
Let's lay the groundwork for that.

## What's being asked

- A scheduled Claude session runs once a day.
- Each run produces one new game preset.
- The repository should be prepared for that before the routine starts running.

## Open questions

- Where does a generated preset live — source, a data file, the database?
- What stops the home page filling up with a year of preset cards?
- What makes a generated preset different from the one generated yesterday?
- What validates that a generated preset is playable and balanced?
- Does the routine push straight to `main`, or open a pull request per day?
- Does anything expire? Are old presets still playable after their day?

## Constraints & non-goals

- "Lay the groundwork" — the routine itself is the user's to schedule.

## Suggested next step

Run `/one-shot` on this.
