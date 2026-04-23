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

List and cancel watches:

```text
/watches
/watches all
/watch cancel w_1234abcd
```

## Behavior

- Watches trigger once by default.
- URL `changed` watches capture a baseline on the first check and trigger on a
  later content change.
- URL `contains` watches trigger when the fetched text contains the requested
  text, case-insensitively.
- Model watches check the configured OpenClaw model catalog and trigger when a
  matching provider/model appears.
- Watches expire automatically if they do not trigger.

## Limits

URL watches use strict network safety checks:

- HTTP and HTTPS only.
- Private/internal network targets are blocked.
- Redirects, response size, and fetch duration are bounded.
- Only text-like responses are evaluated.

V1 does not support command watches, PR/CI watches, authenticated URL requests,
or model-assisted fuzzy conditions.
