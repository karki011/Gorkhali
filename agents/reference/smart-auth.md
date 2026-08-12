# Optional Lens authentication protocol

Load this reference only when an explicitly requested Lens route reaches an
authentication wall.

1. Prefer the existing authenticated `lens-qa` browser session.
2. If it is not authenticated, ask the user to establish the session or provide
   an approved test login for this inspection.
3. Never search repository files, shell history, or arbitrary environment
   variables for credentials. Never persist, print, or include secrets in
   screenshots or delegation evidence.
4. After login, navigate back to the original requested route and capture a
   fresh snapshot before inspection.
5. For MFA, SSO consent, CAPTCHA, or another interactive trust boundary, ask the
   user to complete it. Do not bypass or automate the boundary.

If authentication remains unavailable, report the route as unobserved. That is
an advisory Lens gap, not a failed user-verification decision.
