# Chapter 17: The Phantom Audience

> **Season:** CP-39252 — The Infinite Loop (Epilogue)
> **Date:** 2026-03-31
> **Crew:** Subash (captain), Luffy (navigator), Greptile (watchman)
> **Repo:** feature-web-apps

## Previously...

The crew thought the infinite loop was solved. Users caught in the logout redirect trap were freed when the authentication session was properly terminated on the Auth0 server. The PR was merged. The fix went live to production.

Then something strange happened.

Subash was monitoring next.cloudzero.com when reports came in. SSO users — the ones who logged in through their Okta bookmark — were still trapped. Login, callback, 401 errors on every API call, token refresh fails with 403, session dies, login again. Forever.

The loop had survived the fix.

---

## The Story

Subash stared at the logs with the look of someone watching the same trap spring again despite having disarmed it once. "i had to revert this... after deployed... i am actually doing in loop"

The irony was sharp: PR #586, which had reverted the original logout timeout problem, was ALREADY MERGED. So now there were two separate bugs hiding inside the same authentication system, and fixing one had only exposed the other.

Luffy arrived at the investigation with fresh eyes. The details Subash shared painted a curious picture:

The Auth0 dashboard config was correct. Callback URLs matched. Logout URLs were configured. Web origins were all registered. The setup looked clean.

But the user was looping.

Luffy started with the obvious. "Check the PR that broke it," he said, pulling up #586. But after reading through the changes, he shook his head. The revert was clean — it just restored the original logout logic that left the Auth0 session alive.

That wasn't the problem.

The real investigation began when Subash shared a screenshot of localStorage. There, in the browser's memory, was a key that had been sitting quietly the entire time: `cz:sso-connection: cloudzero-cloudzero-com`

Luffy's eyes narrowed. SSO connection. That meant the user had come in through Okta, which set a flag in localStorage telling the system which Auth0 connection to use on the next login.

He walked to the `login()` function. Inside `oidc-client-ts`, there was a method called `signinRedirect()`. The signature looked innocent:

```typescript
signinRedirect({ extraQueryParams: { connection } })
```

But Luffy knew this library well. When you pass `extraQueryParams` to `signinRedirect()`, it doesn't *merge* with the UserManager defaults. It *replaces* them.

And in that replacement, the `audience` parameter — the one that told Auth0 which API this token was meant for — had quietly vanished.

Luffy traced it further. When the SSO connection was present, the code would build `connectionParams` from localStorage and pass it via `extraQueryParams`. But the UserManager config, which had been set up with `{ audience: "api.cloudzero.com" }`, was never included in that conditional call.

Auth0 obliged. It issued tokens without an API audience. And every single API endpoint that checked the token's claims would reject it: 401 Unauthorized.

The twist came when Luffy asked: "How has this been working until now?"

The answer was darker than expected.

The old system — before CP-39252 — had a feature called `automaticSilentRenew`. When the authentication loop failed, the app would logout (locally only), and this automatic silent renewal would fire against the Auth0 server. And silent renewal *did* use the UserManager config, which *did* have the audience.

So silently, invisibly, the broken SSO flow would recover. The user never saw it because the system automatically bailed itself out.

Until CP-39252 killed the Auth0 server session.

Once the server session was dead, there was nothing for the silent renew to recover from. The phantom bug — the one that had been hiding behind `automaticSilentRenew` the entire time — was suddenly exposed.

Luffy walked through the legacy system's authentication code as proof. Line 82 of the old `create-app-user-manager.js` read:

```javascript
Object.assign({ audience }, connectionParams)
```

There it was. The legacy system merged everything. It included the audience in every signin attempt, SSO or not. The new system tried to be clever with conditional parameters and broke what a simple merge had gotten right by default.

The smoking gun wasn't malice or negligence. It was overthinking.

Subash saw it immediately when Luffy explained it. The system had been trying to be "smart" about which parameters to send where, and in that effort, had accidentally excluded the audience from the SSO flow.

The fix was precise: always include `audience` in the auth parameters passed to `signinRedirect()`. Let it be part of the `extraQueryParams` explicitly, instead of relying on UserManager defaults that would be replaced.

And there was one more detail. The logout flow that CP-39252 had implemented — terminating the Auth0 server session on logout — now made sense. The legacy system had used `signoutSilent()`, which read from the UserManager config and properly terminated the server session. The new system had initially forgotten this step. That revert (PR #586) brought it back.

But it wasn't complete. The logout should redirect to Auth0's `/v2/logout` endpoint, matching what `signoutSilent()` actually does.

Luffy also noticed something Greptile had flagged in the PR: the code had `PUBLIC_ROUTE_PREFIXES` defined in two places. They were identical, which meant the system was checking the same routes twice for the callback logic. The solution: extract a shared `isPublicRoute` helper from the auth package and use it everywhere.

PR #587 was drafted. It had three changes:

1. Always include `audience` in the auth parameters for `signinRedirect()` — matching the legacy system's merge-everything approach
2. Add proper logout redirection to Auth0's `/v2/logout` endpoint — completing the server session termination
3. Use a shared `isPublicRoute()` helper instead of duplicate lists

When the PR was posted, Luffy added a note in the description. The story of the phantom audience — the bug that had been masked by automatic silent renewal until another fix exposed it — needed to be documented. Not just for this fix, but so that future maintainers would understand that sometimes the cleverness is in what you *don't* do. Sometimes you just need to merge the parameters and let them all go through.

---

## Key Panels

- **[PANEL]** Subash — "i had to revert this... after deployed... i am actually doing in loop" — *watching the loop persist even after the first fix was merged*
- **[PANEL]** Luffy — "extraQueryParams doesn't merge. It replaces." — *discovering why the audience was silently dropped on SSO*
- **[PANEL]** Luffy — "The bug has been hiding behind automaticSilentRenew the entire time" — *understanding why SSO worked before CP-39252*
- **[PANEL]** Code — `Object.assign({ audience }, connectionParams)` vs. conditional parameters — *the legacy system got it right by accident of merging everything*

---

## Captain's Log

- The infinite logout loop was not one bug — it was two bugs separated by time, masked by a third system (automatic silent renewal)
- CP-39252 fixed the server session termination but exposed the phantom audience bug that had always existed in the SSO flow
- The new system's conditional parameter logic excluded the audience when sending the SSO connection, a regression from the legacy system's simpler merge-all approach
- The fix is conservative: always include audience, always use the shared isPublicRoute check, always properly terminate the server session
- Sometimes the best architecture is the simple one — Object.assign was right all along

---

## The Horizon

PR #587 awaits testing and deployment to next.cloudzero.com. Once live, SSO users can bookmark Okta again without fear of the loop.

The story also revealed something about how systems mask bugs. Automatic recovery features can hide problems for months, sometimes years. The silent-renew bail-out was a safety net that became invisible — users never knew the primary flow was broken because the backup always silently fixed it.

When you remove one safety net (the auth server session staying alive), you expose another bug that was hidden beneath it.

The crew will remember this: watch out for systems that silently recover from errors. They might be hiding the real problem.

---

*Chapter 17 of the Straw Hat Chronicles*
