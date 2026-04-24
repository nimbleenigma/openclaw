---
title: "Watches"
summary: "Temporary watches for model availability and URL text changes"
read_when:
  - Creating or managing temporary watches
  - Watching a model/provider catalog or URL for a deterministic condition
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

List and cancel watches:

```text
/watches
/watches all
/watch show w_1234abcd
/watch cancel w_1234abcd
```

## Behavior

- Watches trigger once by default.
- URL `changed` watches capture a baseline on the first check and trigger on a
  later content change.
- URL `contains` watches trigger when the fetched text contains the requested
  text, case-insensitively.
- URL `matches` watches trigger when the fetched text matches the regex.
  Plain quoted patterns default to case-insensitive matching. Slash-style
  patterns such as `"/release notes/im"` may use only `i` and `m` flags.
- Model watches check the configured OpenClaw model catalog and trigger when a
  matching provider/model appears.
- Watches expire automatically if they do not trigger.
- HTTP failures such as `403` or `500` are treated as fetch errors, not as
  `text not found`. They stay active with backoff until the configured maximum
  consecutive errors is reached.
- `/watches` shows the next check and compact last result. `/watches all` also
  helps inspect final status and recent errors.

## Test URLs

For deterministic text watches, prefer boring stable pages:

```text
/watch url https://example.com/ contains "Example Domain"
/watch url https://www.iana.org/domains/reserved matches "Reserved\\s+Domains"
```

For change watches, use a URL you control, such as a small raw text file you
can edit after the first baseline check. Many modern sites block unknown bots
or return `403`, so a failing watch may mean the site does not allow simple
unauthenticated fetches.

## Limits

URL watches use strict network safety checks:

- HTTP and HTTPS only.
- Private/internal network targets are blocked.
- Redirects, response size, and fetch duration are bounded.
- Only text-like responses are evaluated.

Watches do not support command watches, PR/CI watches, authenticated URL
requests, or model-assisted fuzzy conditions.
