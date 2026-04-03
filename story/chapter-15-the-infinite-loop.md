# Chapter 15: The Infinite Loop

> **Arc:** CP-39252 — The Infinite Loop
> **Date:** 2026-03-31
> **Crew:** Luffy (coordinator), Sonnet (Auth0 researcher), Haiku (route researcher), Opus (state researcher), Shanks (architecture reviewer), Ace (performance specialist), Roger (code reviewer), Chopper (verification)
> **Repo:** feature-web-apps

## Previously...

The crew had just finished weaving new guide-lights into the ship's interface and silencing the hidden chart behind the legend panel. For a brief morning, the Thousand Sunny felt calm. Then the distress signal arrived — not from outside, but from the ship's own front door. A sailor trying to leave kept being dragged back inside. The exit was broken. And no one yet understood why.

---

## The Story

The report came in without drama: a user logs out, the ship's front gate swings open, they step through — and then the gate slams shut and deposits them right back where they started. Over and over. The door to the outside world had become a revolving trap.

Luffy did not waste time theorizing. He split the crew into three parallel scouting parties and sent them into the ship's deepest corridors at the same moment.

Sonnet took the auth passages — the rooms where identity tokens were minted and validated. Haiku moved fast along the outer hull, checking every hatch marked "public" and every lock marked "protected." Opus descended into the bilge: the state machinery, the session monitors, the invisible gears that kept the ship authenticated even when nobody was watching.

All three reported back within minutes.

Sonnet's report was thorough. She had traced the full journey a user takes from login to logout across six different rooms, drawn diagrams, labeled every choke point. Her conclusion was solid, her proposed repair reasonable. It included one detail that would later matter: she recommended using a standard OIDC method called `signoutRedirect` to close the session properly.

Haiku had moved faster than either of them. His report was lean — the right hatches, the right guards, the confirmation that the `/logout` door was already marked as public and would not re-lock on its own. Useful intelligence, gathered in record time, though it didn't reach the bottom of the problem.

Opus came back last. He had gone furthest.

He had drawn up seven theories, lettered A through G, and worked through each one like a navigator eliminating false headings. Theory A: the redirect logic pointed at the wrong destination. Theory B: the session cookie outlived the logout. Theory C, D, E, F — each examined and crossed out in turn.

Theory G was different.

When a user reached the `/logout` page, a background process called `automaticSilentRenew` was still running. It had never been told to stop. Its only job was to keep the user authenticated — silently, invisibly, without prompting. And so the moment the front door opened, this mechanism reached out to the Auth0 server, confirmed the session was still live, and pulled the user back inside.

The logout had never actually closed the Auth0 server session. The lock on the exit had always been a prop.

Luffy read all three reports. He handed them to Shanks.

---

Shanks was not the kind of man who celebrated early. He read slowly. When he reached Sonnet's fix proposal — the `signoutRedirect` call — he set the paper down.

"This won't work," he said. "Not with Auth0."

The room went quiet.

He explained. The standard OIDC method expected a parameter called `post_logout_redirect_uri`. Auth0 did not honor that parameter. Auth0 had its own endpoint, its own rules, its own name for where to send the user afterward: `returnTo`. If the crew shipped Sonnet's fix, the logout would fire, the standard handshake would go out, and Auth0 would stare at it blankly. The loop would continue.

He had also checked the git history to make sure this wasn't an accidental omission — the standard method had never been used in this codebase. It was an intentional absence, not a forgotten tool.

"We build the logout URL by hand," Shanks said. "We point it at Auth0's own endpoint. We use `returnTo`. That is the only path that closes the door."

Ace ran the numbers. The manual redirect added roughly 250 to 650 milliseconds depending on network conditions. The hot path — the check that ran on every page load to verify authentication — was untouched. The cost was acceptable.

Three guards went up around the fix to prevent the loop from finding another way back in. The auth context was updated so logout now redirected through Auth0's endpoint directly. A utility was extracted to filter out public pages — `/logout` and `/callback` — from ever being saved as a destination to return to after login. And the login process itself was taught to check that guard before recording where a user had been.

Roger examined the result. Minimal. Clean. No new patterns introduced, no unnecessary abstractions added. The existing `isPublicRoute` function, already trusted, was doing the filtering. He signed off.

Chopper ran the full verification sweep. Eighty-four packages built without complaint. Sixteen auth tests passed. The lint found nothing new. The ship was clean.

And then, in the logs, the confirmation line appeared:

`[auth] redirecting to Auth0 /v2/logout: ...`

The door opened. The user stepped through. The door stayed open.

---

One note arrived afterward, from Errol in the external review. He had looked at the new tests — twenty-six of them, covering every path through the logout logic — and asked whether parameterized testing had been considered. The question was fair. The crew logged it. The tests would be reviewed before the branch closed.

Seven agents. Four phases. One session. No conflicts.

The revolving door was gone.

---

## Key Panels

- **[PANEL]** Opus — "Theory G. `automaticSilentRenew` never stops. It pulls them back in before they can leave." — *the breakthrough, spoken quietly at the bottom of the ship*
- **[PANEL]** Shanks — "signoutRedirect() will NOT work with Auth0. We build the URL ourselves." — *the correction that saved the fix from shipping broken*
- **[PANEL]** Chopper — "84 projects. 16/16 auth tests. Clean." — *the moment the verification log printed green*

---

## Captain's Log

- Used Auth0's `/v2/logout` endpoint with `returnTo` parameter instead of the OIDC-standard `signoutRedirect()`. Auth0 does not honor the OIDC standard for logout redirects. This was not a shortcut — it was the only correct path.
- Extracted `getSafeReturnPath` as a standalone utility so the filter for public routes could be shared across auth context and callback route without duplication.
- Three research agents with different models (Sonnet / Haiku / Opus) produced genuinely different findings. The fastest was not the deepest. The most thorough report still contained one critical error. Architecture review is not optional on protocol-level work.

---

## The Horizon

The Auth0 dashboard still needs to whitelist the logout URL for every environment before this can deploy. That step lives outside the codebase — it cannot be automated, only documented and tracked.

Errol's question about parameterized tests is open. The twenty-six tests are passing, but the structure could be tighter.

And somewhere in the ship's memory, `automaticSilentRenew` still runs during normal sessions — doing exactly what it was built to do. The crew has tamed it for logout. Whether it hides other surprises in edge cases no one has yet thought to test for... that is a question for another voyage.

The door is open. For now, it stays that way.

---
*Chapter 15 of the Straw Hat Chronicles*
