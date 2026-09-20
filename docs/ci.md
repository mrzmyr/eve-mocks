# Run in CI

```yaml
- run: bun install --frozen-lockfile
- run: bun run eval --mocks
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }} # the one allowed upstream
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: eve-mocks-report, path: .eve-mocks/report.json }
```

That is the whole job. No service containers, no ports to wait for, no fixtures
to seed.

## Schemas are committed, not pulled

`pull` is the one command that calls a real upstream, and it runs on your
machine. CI reads `mocks/schemas/` from the repository, so it needs neither the
upstreams nor their credentials. A changed tool description then arrives as a
diff in a pull request instead of as an eval that fails on one machine.

## A blocked call fails the run

A run whose command exited 0 still exits 1 when any call was blocked. Without
that, a model that recovers from the thrown error hides the fact that the agent
reached for an upstream nobody decided on, and the eval passes anyway.

Opt out with `--no-fail-on-blocked`, in the wrapped command or before `--`.

## Secrets

Only the upstreams you [allow](allow.md) need one, usually just the model gateway.
Connection credentials are not needed, because the token endpoints are mocked
and each connection's real token code still runs against them. See
[token endpoints](authentication.md#token-endpoints).

## The run report

Every run under `--mocks` writes `.eve-mocks/report.json`, which holds the
latest run:

```json
{
  "command": ["eve", "eval"],
  "exitCode": 0,
  "counts": { "mocked": 18, "allowed": 14, "blocked": 0 },
  "targets": [{ "outcome": "mocked", "target": "linear", "calls": 10, "tools": { "get_issue": 4 } }],
  "log": ".eve-mocks/runs/2026-09-20T18-22-31-114Z-4821.jsonl"
}
```

`tools` counts MCP `tools/call` by tool name, which answers "did the agent call
`create_issue`?". The call log of that run sits next to it, one JSON object per
line; the last 10 runs are kept. The folder ignores itself in git, so no app
has to touch its own `.gitignore`.

## Fail when a connection has no mock

The run only reports what the agent happened to call. To fail on a connection
that nobody has mocked yet, before any eval runs:

```yaml
- run: bunx eve info
- run: bunx eve-mocks list --json | jq -e '[.[] | select(.isConnection and .status == "blocked")] | length == 0'
```

## Logs

Colour is dropped when the output is not a terminal and when `NO_COLOR` is set,
so the summary stays readable in a CI log. Icons stay either way.
