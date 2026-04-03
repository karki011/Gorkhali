# Chapter 18: The Wired Sea

> **Arc:** mqtt-session-spike — Research Phase
> **Date:** 2026-04-01
> **Crew:** Luffy (Team Lead), Jinbe (Backend Coordinator), Robin (Documentation)
> **Repo:** feature-web-apps · feature-identity · feature-user-session-gateway

## Previously...

The Phantom Audience had been vanquished. SSO users were free from their loops. PR #587 had closed one of the more harrowing chapters in the crew's authentication saga.

But the sea does not sleep.

A question had been whispered in the ship's corridors for some time: *Why does the Thousand Sunny keep poking the horizon with a stick every thirty seconds just to know if the session is still alive?* There had to be a better way — a way the ship could be *told* when something changed, instead of asking over and over and over.

The ticket was logged. The spike was green-lit. The crew assembled.

---

## The Story

Luffy spread the map across the navigation table and looked at his crew with the particular kind of grin that meant work was about to get interesting.

"Three codebases," he said. "Three researchers. We go deep — all at once."

This was the Straw Hat way when the territory was unknown: swarm it. Don't probe it politely. Flood it with parallel light and see what the darkness contains.

Jinbe cracked his knuckles. "I'll take both backend services."

Robin opened her notebooks. "I'll hold the record."

Three Opus-class research agents deployed simultaneously across the fleet — one into the CZ frontend monorepo, one into feature-identity, one into the depths of feature-user-session-gateway.

---

### The Frontend's Secret

The FE researcher arrived in the session management code with the systematic patience of someone who had done this before. What they found was not simple.

The Thousand Sunny's polling system was *adaptive*. When a user was actively working — keyboard strokes, mouse clicks, page focus — the ship checked the session every 30 seconds. When the user grew still, the polling slowed. A quiet user got a 15-minute check interval. The ship was smart about it, running quiet when it didn't need to shout.

There was a SessionMonitor. There was an ActivityTracker. There was a full infrastructure of timers and visibility listeners and beforeunload handlers — all built to do one thing: catch the moment the session was about to expire and warn the user before the logout came without warning.

Then the FE researcher found something that made them stop.

Deep in the subscription hooks, buried in the MQTT client initialization, there was a topic subscription. The frontend already subscribed to it on startup. Had been subscribing to it. Was ready and waiting for messages to arrive.

The topic: `session/expiring`

The researcher stared at the code. The subscriber was there. The handler was wired. The mechanism to receive real-time session warnings via WebSocket was already built into the ship.

But nothing had ever sent a message to that topic. Not once.

"The plug is in the wall," the researcher noted. "But no one has ever turned on the power."

---

### The Identity Proxy

Meanwhile, Jinbe arrived in feature-identity and found a spartan service: clean, focused, architecturally humble. It was an Auth0 proxy. It fetched token data, shaped it into CloudZero claims, and returned it.

No MQTT. No IoT. No publish functions. No concept of notifying anyone about anything.

The service did its job precisely and nothing more. It knew when sessions were going to expire — it could calculate that from the token data it fetched — but it had never been asked to tell anyone.

Jinbe took careful notes. The identity service sat in the middle of the chain. It had the *knowledge* of expiration. What it lacked was a *voice*.

---

### The Gateway's Infrastructure

The third researcher arrived in feature-user-session-gateway and discovered something extraordinary.

This service was not just a session manager. It was a fully realized IoT messaging hub. The gateway had a direct line to AWS IoT Core. It maintained MQTT topics per user, per tenant, with careful scoping. It had envelope formats. It had publish functions.

The researcher mapped the full topology:
- User-scoped topics for isolated messaging
- Tenant-level broadcast channels
- A helper function — `publish_to_user()` — that could push any message payload to any user's topic with a single call

The infrastructure was not theoretical. It was production-grade, already in use for other notification types in the CloudZero platform.

There was one gap.

The gateway's publish functions did not support `retain=True`. In MQTT, a retained message is one the broker holds and delivers to *any new subscriber* — meaning a client that connects after the fact still gets the last known value. For session warnings, this was important: if a user opened a new browser tab, their client should immediately know whether the session was near expiring, without waiting for the next polling cycle.

But `retain=True` was one parameter away from being supported. The function signature was the only thing standing between the current state and a retained message.

---

### The Synthesis

Luffy gathered the three research reports and laid them side by side on the navigation table. The picture that emerged was almost shocking in its completeness.

The frontend subscribed to `session/expiring`. Check.

The gateway could publish to any user topic. Check.

The identity service had the expiration data. Check.

The infrastructure was **80% wired**.

The missing piece was simply: someone needed to call `publish_to_user()` from the identity service after fetching Auth0 data, targeting the `session/expiring` topic, with `retain=True` enabled in the gateway.

Three services. Three small changes. Total implementation estimate: approximately 150 lines of code across the entire fleet.

"This is the easiest feature we've never shipped," Jinbe said quietly.

Luffy was already drawing the architecture on the whiteboard. Two topics. Two responsibilities:

- `session/expiring` — *retained*, delivered immediately on connection, warns clients that expiration is near
- `session/invalidated` — *not retained*, fire-and-forget, tells clients the session is gone

The hybrid approach: MQTT as the primary signal, with polling reduced from 30 seconds to a 15-minute safety net in case the WebSocket ever dropped. The best of both worlds. The system becomes reactive instead of persistent, quiet instead of chatty, real-time instead of approximate.

One thing they would *not* do: Auth0 Log Streams. That path was tempting — Auth0 can emit real-time events — but it required more infrastructure, more cost, more complexity. The crew knew when a simpler path was in front of them.

"Defer it," Luffy said. "We don't need it. The gateway already has the publish capability."

---

### The Canvas

With the research complete and the plan synthesized, Luffy built the Slack canvas. Every finding, every file path, every function signature, every gap — organized into a clear brief for the backend team who would need to add `retain=True` support to the gateway's publish function before the plan could go live.

The canvas was shared with the backend engineering team: https://cloudzero.slack.com/docs/T1714N33Q/F0APV4UH3P1

The spike was complete. No code had been written. None needed to be. The point of the research was to understand whether the path was clear before anyone picked up a tool.

The path was clear.

---

## Key Moments

- **[PANEL]** Luffy — *"Three codebases. Three researchers. We go deep — all at once."* — setting the parallel research formation at the navigation table
- **[PANEL]** FE Researcher — *"The plug is in the wall. But no one has ever turned on the power."* — discovering `session/expiring` already subscribed in the frontend, waiting for messages that never came
- **[PANEL]** Jinbe — *"It had the knowledge of expiration. What it lacked was a voice."* — assessing the identity service as an MQTT-silent Auth0 proxy
- **[PANEL]** Gateway Researcher — mapping `publish_to_user()` and realizing retained messages were one parameter flag away from being supported
- **[PANEL]** Luffy — *"This is the easiest feature we've never shipped."* — synthesizing the three findings and realizing the infrastructure was already 80% complete
- **[PANEL]** Robin — writing everything down before anyone could forget it

---

## Decisions

| Decision | Outcome |
|---|---|
| Polling vs. MQTT | **Hybrid** — MQTT primary, 15-minute polling as safety net |
| Session expiring topic | `session/expiring` with `retain=True` — new subscribers get the state immediately |
| Session invalidated topic | `session/invalidated` without retention — one-time event notification |
| Auth0 Log Streams | **Deferred** — unnecessary complexity when the gateway already can publish |
| Implementation scope | ~150 lines across 3 repos — frontend hook, identity publish call, gateway `retain` flag |

---

## The Horizon

The backend team has the canvas. The `retain=True` gap in the gateway is the only blocker before implementation begins.

When that flag is added, the Thousand Sunny will stop polling the horizon every thirty seconds. Instead, the sea itself will speak. The session gateway will reach out through the wired current of MQTT, touch every open browser tab simultaneously, and whisper: *your time is running short.*

The ship will listen instead of asking.

The crew leaves this chapter having done the rarest and most underrated thing in engineering: they mapped the territory before building the road. Three researchers, three codebases, one afternoon — and they found that most of the work had already been done by the sailors who came before them.

The infrastructure was waiting. It just needed someone to find it.

---

*Chapter 18 of the Straw Hat Chronicles*
