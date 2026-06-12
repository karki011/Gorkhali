# Smart Auth Protocol

Lens handles login walls autonomously. No pre-configured auth needed — reads the page and figures it out.

## Credential Sources (checked in order)

1. **Session state:** `sessions/{TICKET}/auth-creds.json` — `{ "username": "...", "password": "..." }`
2. **Environment variables:** `TEST_USERNAME` + `TEST_PASSWORD`
3. **Repo config:** `.env.test` or `.env.local` — look for `USERNAME`, `EMAIL`, `PASSWORD`, `TEST_USER`, `TEST_PASS` keys
4. **Ask once, save:** If no creds found, ask user once. Save to `sessions/{TICKET}/auth-creds.json` for reuse.

## Detection + Login Flow

Every navigation goes through redirect-aware auth detection.

```
1. SAVE original target: ORIGINAL_ROUTE = requested path

2. Navigate to ORIGINAL_ROUTE

3. Check current URL:
   - Matches ORIGINAL_ROUTE → no redirect, proceed to inspection
   - Different → redirect happened, go to step 4

4. REDIRECT DETECTED — snapshot the landing page:
   - Extract return path from query params: ?redirect=, ?next=, ?returnTo=, ?return_url=, ?callbackUrl=
   - If no param → RETURN_ROUTE = ORIGINAL_ROUTE (navigate back manually after login)

5. DETECT auth wall from snapshot:
   URL signals — path contains: /login, /signin, /sign-in, /auth, /sso, /oauth, /session/new
   Element signals:
   - Input with label matching: email, username, login
   - Input with type="password"
   - Button with text matching: sign in, log in, submit, continue
   - Heading containing: sign in, log in, welcome back
   
   No login signals → skip route (autonomous) or ask user (standalone)

6. LOGIN — if form detected:
   a. Load credentials from sources above
   b. Fill username field (scan snapshot for email/username input)
   c. Fill password field (type="password" input)
   d. Click submit (button with sign in/log in/submit text)
   e. Wait 3 seconds for post-login navigation

7. VERIFY login succeeded:
   Check: URL changed away from login? No login form in snapshot? No error messages?
   
   SUCCESS → navigate to ORIGINAL_ROUTE if not already there. Cookies persist for session.
   PARTIAL (intermediate page: welcome wizard, terms) → find skip/continue button, then navigate.
   FAILURE → screenshot error, do NOT retry with same creds. Skip route or ask user.

8. SUBSEQUENT ROUTES in same session:
   - Session cookies persist — no re-login needed
   - If redirected again → different auth scope, repeat from step 4
   - Different login page (different domain/SSO) → repeat full flow
```

## Multi-Factor / SSO / OAuth

- MFA/2FA prompt → escalate to user: "MFA required. Please complete authentication manually."
- OAuth redirect (Google, Okta) → follow redirect chain; if interactive consent needed → escalate
- SAML/SSO → follow redirect, attempt login on IdP if fields detectable

One login attempt per route. If it fails, move on.

