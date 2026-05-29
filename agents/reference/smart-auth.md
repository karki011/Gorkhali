# Smart Auth Protocol

Reference for Lens agent — handles login walls, redirect detection, credential sources, and MFA.

## When Auth is Needed

After navigation, if the accessibility snapshot shows a login form (username/password fields, "Sign in" button, OAuth buttons), the page requires authentication before inspection can proceed.

## Credential Sources (checked in order)

1. **Environment variables**: `APP_USERNAME`, `APP_PASSWORD`, `APP_EMAIL` (or project-specific variants from `.env`)
2. **CLAUDE.md / project docs**: Some projects document test credentials
3. **Apex prompt**: Credentials may be passed directly in the spawn prompt
4. **Session cookies**: If agent-browser daemon has an active session from a previous run, auth may already be present

If no credentials are found from any source, report `AUTH_BLOCKED` and stop — do not guess or use placeholder credentials.

## Login Flow

1. **Detect login wall**: Snapshot shows login form elements
2. **Find credential source**: Check sources above in order
3. **Fill form**: Use element refs (`@eN` for agent-browser, selectors for Playwright)
   ```bash
   # agent-browser
   agent-browser --session-name lens-qa type @e3 "user@example.com"
   agent-browser --session-name lens-qa type @e5 "password123"
   agent-browser --session-name lens-qa click @e7   # Submit button
   
   # Playwright MCP
   browser_fill @username "user@example.com"
   browser_fill @password "password123"
   browser_click @submit
   ```
4. **Wait for redirect**: After submit, wait 2-3 seconds, then snapshot again
5. **Verify auth succeeded**: New snapshot should show the target page, not the login form

## Redirect Detection

After clicking submit:
- If snapshot still shows login form → credentials were wrong or MFA is required
- If snapshot shows an error message → extract and report the error
- If snapshot shows the target page → auth succeeded, proceed with inspection

## MFA Handling

If a TOTP/MFA prompt appears after login:
1. Check for `APP_TOTP_SECRET` env var
2. If available, generate TOTP code and fill
3. If not available, report `AUTH_BLOCKED: MFA required, no TOTP secret configured`

## OAuth Flows

If the login page shows OAuth buttons (Google, GitHub, SSO):
- Do NOT attempt OAuth flows — they require browser redirects that may not work in headless mode
- Report `AUTH_BLOCKED: OAuth login required — provide direct credentials or pre-authenticated session cookies`

## Session Persistence

- **agent-browser**: Sessions persist across commands within the same `--session-name`. Once authenticated, subsequent navigations in the same session retain auth.
- **Playwright MCP**: Sessions persist within the same browser instance but are lost on `browser_close`.
