#!/usr/bin/env bash
# List tasks that are open and not blocked by a still-unresolved task, and
# report on ideas that are still in flight.
#
# The open front lives in tasks/*.md, one file per task, with YAML-ish
# frontmatter. Resolving a task deletes its file, so anything still present
# here is still open, and blocking resolves by file existence rather than by
# the status field -- deleting a blocker surfaces whatever it was blocking.
#
# Ideas live in ideas/<slug>.md on an idea/<slug> branch and never reach main,
# so this also names the open idea branches and flags any idea doc that leaked
# onto main -- both are read off git and the filesystem, with nothing tracking.
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

# ideas -- open idea branches, and any idea doc that leaked onto main.
# Everything here degrades to silence outside a git checkout.
ideas() {
  git rev-parse --git-dir >/dev/null 2>&1 || return 0

  here=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  main=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  main=${main#origin/}
  main=${main:-main}

  # An idea doc on the trunk means the dispersal step was skipped. That is the
  # one thing here that is a defect rather than a status, so it prints first.
  leaked=$(git ls-tree --name-only "$main" ideas/ 2>/dev/null)
  if [ -n "$leaked" ]; then
    printf '\n  LEAKED onto %s -- disperse and delete these:\n' "$main"
    printf '%s\n' "$leaked" | sed 's/^/    /'
  fi

  branches=$(git branch -a --format='%(refname:short)' 2>/dev/null |
    sed 's|^origin/||' | grep '^idea/' | sort -u)
  [ -n "$branches" ] || return 0

  printf '\n  ideas in flight:\n'
  printf '%s\n' "$branches" | while read -r b; do
    # The short name is what you want to read, but an idea branch pushed from
    # another machine -- or from a web sandbox -- exists only as origin/<name>
    # here, so count against whichever ref actually resolves.
    ref=$b
    git rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || ref="origin/$b"
    n=$(git rev-list --count "$main..$ref" 2>/dev/null || echo '?')
    unit=commits
    [ "$n" = 1 ] && unit=commit
    mark=""
    [ "$b" = "$here" ] && mark="   <- you are here; read ideas/${b#idea/}.md"
    printf '    %-28s %s %s%s\n' "$b" "$n" "$unit" "$mark"
  done

  # Two is the tripwire: past it you are collecting ideas rather than building
  # them. Resolve one with a ruled-out: merge or by deleting the branch.
  count=$(printf '%s\n' "$branches" | wc -l)
  [ "$count" -gt 2 ] && printf '\n  %s idea branches open -- pick one, resolve the rest.\n' "$count"
  return 0
}

files=(tasks/*.md)
if [ ${#files[@]} -eq 0 ]; then
  echo "No tasks/ directory or no task files -- nothing open."
  ideas
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

ideas
