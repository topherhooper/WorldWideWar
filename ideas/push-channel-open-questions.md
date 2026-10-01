# Push channel: questions before building

Captured from: "We just merged a detailed plan. Can you pull it up?" then "Create a pr with
your open questions that I will answer in the pr and get back to you."

The plan is `docs/design/group-scheduler-push-plan.md`, for `tasks/web-push-reaches-a-phone.md`.
Nothing is built yet. This branch holds only questions, answered in PR comments.

## What would make it real

Each question below has an answer in a PR comment, after which the plan is amended and the
build starts without another round trip.

## Found in the code, not in the plan

- `docs/deployment.md:274` lists three places an origin must be allowed. The plan's [human]
  list (item 4) covers two: Auth authorized domains and OAuth redirect URI. It omits the third,
  the API key referrers.
- The same key is restricted to `identitytoolkit` and `securetoken` only
  (`docs/deployment.md:295`). FCM's `getToken` also calls the Firebase Installations and FCM
  Registration APIs with that key, so it would be rejected even on an allowed origin.
- `packages/web/public/` does not exist yet, and `firebase.json` has no `headers` block.
- `.env.production` holds only API key, auth domain and project id.

## Assumptions made instead of asking

- The build runs in a cloud sandbox: steps 1-9 are doable here, step 10 and every [human]
  item are not (no console, no gcloud credentials, no phone).
- The plan's wording for the iPhone walkthrough is used as-is.

## Questions

See the PR body; answers are recorded there and folded into the plan, then this branch is
closed without merging (an idea doc never reaches `main`).
