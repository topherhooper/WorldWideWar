<!-- ideas/<slug>.md -- lives on the idea/<slug> branch and NEVER on main.

     Sections are added as the idea moves through the stages; an idea that is
     only captured has just the first two, and that is a complete idea doc.
     Delete the sections you have not reached rather than leaving them empty. -->

# <The idea, in the words it was said in>

## Why now

<What prompted it, and what it is for. One or two lines -- this is the part that
stops the idea being re-litigated from scratch in a month.>

## What would make it real

<One observable thing. Not "better X" -- something you could watch happen.>

## What we found

<Links opened and what they actually said, not just the URLs. file:line pointers
into the code this touches. Anything a fresh session would otherwise re-derive.>

## Assumed, not asked

<Every question that was not worth stalling on, and the answer assumed instead.
Cheap to correct here; expensive as an offhand answer to an up-front question.>

## Prototype goal

<Required before prototyping. One sentence, observable outcome. If you cannot
write it, the idea is not ready to prototype -- brainstorm instead.>

## Decisions

<!-- Appended by brainstorming. The rejections are the durable half: they are
     the only thing in this file that is not recoverable from git, and they are
     what moves to docs/design/<slug>.md at merge. -->

| Decision | Chose | Rejected, and why |
| -------- | ----- | ----------------- |

## Route

<!-- Appended by planning. Prose, no checkboxes -- a list of ticked steps is
     recoverable from the log and survives only as a stale claim about what is
     left. One tasks/ file comes out of this, for the next action only. -->

## Why not

<!-- Written only if the prototype aborted. What the change actually is, what it
     costs, and what would have to be true to make it worth doing. This becomes
     the body of a `ruled-out:` PR, which merges -- so that main carries the
     reason and the idea is not re-proposed by someone with no memory of it. -->

<!-- Dispersal, when this branch merges: this file is DELETED, decisions and
     route go to docs/design/<slug>.md, the next action goes to tasks/<slug>.md,
     and the finding goes in the PR body. If nothing survives that, the idea
     produced nothing -- delete the branch, which is also a result. -->
