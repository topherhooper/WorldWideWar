#!/usr/bin/env bash
# List tasks that are open and not blocked by a still-unresolved task.
#
# The open front lives in tasks/*.md, one file per task, with YAML-ish
# frontmatter. Resolving a task deletes its file, so anything still present
# here is still open, and blocking resolves by file existence rather than by
# the status field -- deleting a blocker surfaces whatever it was blocking.
#
# No dependencies beyond bash and coreutils. This has to run in a bare clone
# with no toolchain installed, including a Claude Code web sandbox. Do not
# rewrite it in the project's language.

set -u
cd "$(dirname "$0")/.." || exit 1
shopt -s nullglob

# field <file> <name> -- first value of a frontmatter key, quotes stripped.
# Strips single and double quotes: a repo whose formatter normalises YAML to
# single quotes turns blocked-by: "" into blocked-by: '', and stripping only
# double quotes would leave a two-character value that reads as a blocker slug.
field() { sed -n "s/^$2: *//p" "$1" | head -1 | tr -d "\"'"; }

# unresolved <file> -- true if the file exists and is still open or blocked
unresolved() {
  [ -f "$1" ] || return 1
  case "$(field "$1" status)" in
    open | blocked) return 0 ;;
    *) return 1 ;;
  esac
}

files=(tasks/*.md)
if [ ${#files[@]} -eq 0 ]; then
  echo "No tasks/ directory or no task files -- nothing open."
  exit 0
fi

ready=""
blocked=""

for f in "${files[@]}"; do
  unresolved "$f" || continue

  slug=$(basename "$f" .md)
  title=$(sed -n 's/^# //p' "$f" | head -1)
  blocker=$(field "$f" blocked-by)

  if [ -n "$blocker" ] && unresolved "tasks/$blocker.md"; then
    blocked="${blocked}    ${slug} <- ${blocker}"$'\n'
    continue
  fi

  line=$(printf 'P%s  %-10s %-11s %-24s %s' \
    "$(field "$f" priority)" \
    "$(field "$f" area)" \
    "$(field "$f" kind)" \
    "$slug" "$title")
  ready="${ready}${line}"$'\n'
done

if [ -n "$ready" ]; then
  printf '%s' "$ready" | sort
else
  echo "Nothing ready."
fi

if [ -n "$blocked" ]; then
  printf '\n  blocked:\n%s' "$blocked"
fi
