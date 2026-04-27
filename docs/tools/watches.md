---
title: "Watches"
summary: "Temporary watches for model availability, URL changes, and GitHub PR checks"
read_when:
  - Creating or managing temporary watches
  - Watching a model/provider catalog, URL, or public GitHub PR for a deterministic condition
  - Debugging watch notifications
---

# Watches

Watches are temporary checks that notify the originating chat when a condition
becomes true. They are user-facing as watches, not cron jobs or Task Flow runs.

## Commands

Create a model availability watch:

```text
/watch models gpt-5.5 until available
```

Create a URL text watch:

```text
/watch url https://example.com/news contains "GPT-5.5 API"
```

Create a URL change watch:

```text
/watch url https://example.com/news changed
```

Create a URL regex watch:

```text
/watch url https://example.com/news matches "GPT-5\\.5\\s+API"
```

Create a URL watch against readable page text instead of raw response text:

```text
/watch url https://example.com/news text contains "GPT-5.5 API"
/watch url https://example.com/news changed text
/watch url https://example.com/news text matches "release\\s+notes"
```

Create a public GitHub PR checks watch:

```text
/watch github pr https://github.com/openclaw/openclaw/pull/123 until checks pass
```

Create a public GitHub PR snapshot change watch:

```text
/watch github pr openclaw/openclaw#123 changed
```

The command stays short, but `changed` means the PR snapshot changed: lifecycle
state, draft state, merged state, head SHA, or checks rollup.

List and cancel watches:

```text
/watches
/watches all
/watch show w_1234abcd
/watch cancel w_1234abcd
```

## Assistant Tool

Agents can manage the same watches without emitting slash-command text through
the `watches_manage` tool. The tool supports these actions:

- `create_model_availability`
- `create_url_contains`
- `create_url_matches`
- `create_url_changed`
- `create_github_pr_checks`
- `create_github_pr_state` for PR snapshot changes
- `list`
- `show`
- `cancel`

Tool-created watches use the current requester/session as the owner and notify
the same captured chat target as slash-created watches.
URL create actions may pass `content_mode: "text"` to evaluate readable page
text; omit it, or use `raw`, for the original raw response-text behavior.

## Behavior

- Watches trigger once by default.
- URL `changed` watches capture a baseline on the first check and trigger on a
  later content change.
- URL `contains` watches trigger when the fetched text contains the requested
  text, case-insensitively.
- URL `matches` watches trigger when the fetched text matches the regex.
  Plain quoted patterns default to case-insensitive matching. Slash-style
  patterns such as `"/release notes/im"` may use only `i` and `m` flags.
- URL page-text mode strips `script`, `style`, `noscript`, and `template`
  content from HTML, prefers `main` or `article` text when present, decodes
  common HTML entities, and collapses whitespace before evaluating the
  condition. Raw mode remains the default for exact response-text watches.
- Model watches check the configured OpenClaw model catalog and trigger when a
  matching provider/model appears.
- GitHub PR `until checks pass` watches use the public GitHub REST API to read
  the PR head commit, commit statuses, and check runs. They trigger only after
  at least one status/check signal exists and all reported signals are passing.
- GitHub PR `changed` watches are PR snapshot watches. They capture a baseline
  on the first check and trigger when concise PR snapshot fields change later,
  including lifecycle state, draft state, merged state, head SHA, and checks
  rollup.
- GitHub PR notifications use a compact chat-friendly block. Snapshot-change
  notifications include simple before/after lines when the previous stored
  summary is available.
- Watches expire automatically if they do not trigger.
- HTTP failures such as `401`, `403`, `429`, or `500` are treated as fetch
  errors, not as `text not found`. They stay active with backoff until the
  configured maximum consecutive errors is reached.
- Common URL fetch failures are summarized for chat output: blocked basic
  fetches, rate limits, timeouts, non-text responses, oversized responses,
  unsafe/private targets, and redirect problems avoid stack traces and explain
  the bounded unauthenticated fetch model.
- `/watches` shows the next check and compact last result. `/watches all` also
  helps inspect final status and recent errors.

## Test URLs

For deterministic text watches, prefer boring stable pages:

```text
/watch url https://example.com/ contains "Example Domain"
/watch url https://www.iana.org/domains/reserved matches "Reserved\\s+Domains"
/watch url https://www.iana.org/domains/reserved text contains "Reserved Domains"
```

For change watches, use a URL you control, such as a small raw text file you
can edit after the first baseline check. Many modern sites block unknown bots
or return `403`, so a failing watch may mean the site does not allow simple
unauthenticated fetches. A `403` message like "This site blocked the basic
fetch" means the watch did not reach readable content; use a simpler public URL
or wait for a future browser-rendered watch mode.

Example URL notification:

```text
🔎 URL text found

https://example.com/
Matched: "Example Domain"
HTTP 200 · text/html
```

Example URL change notification:

```text
👀 URL changed

https://example.com/news
Baseline changed since last check
HTTP 200 · text/html · page text
```

For GitHub PR watches, use public pull requests:

```text
/watch github pr openclaw/openclaw#123 until checks pass
/watch github pr https://github.com/openclaw/openclaw/pull/123 changed
```

Example checks notification:

```text
✅ PR checks passed

openclaw/openclaw#123 — Fix gateway startup
State: open
Checks: 4 passing
Head: abc1234

https://github.com/openclaw/openclaw/pull/123
```

Example snapshot notification:

```text
👀 PR snapshot changed

openclaw/openclaw#123 — Fix gateway startup
State: open
Checks: pending (no checks reported) → 4 passing
Head: abc1234 → def5678

https://github.com/openclaw/openclaw/pull/123
```

GitHub PR watches are unauthenticated in this version. Public repositories work
within GitHub's anonymous API rate limits; private repositories and higher rate
limits are deferred until there is a plugin-owned auth path.

## Limits

URL watches use strict network safety checks:

- HTTP and HTTPS only.
- Private/internal network targets are blocked.
- Redirects, response size, and fetch duration are bounded.
- Only text-like responses are evaluated.

Watches do not support command watches, arbitrary cron schedules, authenticated
URL requests, private GitHub repositories, review/comment activity watches, or
model-assisted fuzzy conditions. CSS selector targeting is also deferred; page
text mode is intentionally lightweight and deterministic.
