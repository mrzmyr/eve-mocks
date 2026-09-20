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

<!-- site:accordion -->

### Do I run `pull` in CI?

No. Schemas are committed, not pulled. `pull` is the one command that calls a
real upstream, and it runs on your machine. CI reads `mocks/schemas/` from the
repository, so it needs neither the upstreams nor their credentials. A changed
tool description then arrives as a diff in a pull request instead of as an eval
that fails on one machine.

### Why did CI fail when every eval passed?

A call was blocked. A run whose command exited 0 still exits 1 when the agent
called an upstream that is neither mocked nor allowed. Without that, a model
that recovers from the thrown error hides it, and the eval passes anyway. The
summary names each blocked host and the fix.

Opt out with `--no-fail-on-blocked`, in the wrapped command or before `--`.

### Which secrets does CI need?

Only those of the upstreams you [allow](allow.md), usually just the model
gateway. Connection credentials are not needed: the
[token endpoints](authentication.md) are mocked, and each connection's real
token code runs against them.

### Where do I see what the agent called?

In `.eve-mocks/report.json`, which every run under `--mocks` writes. The
workflow above uploads it as an artifact.

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
line; the last 10 runs are kept. The folder ignores itself in git.

### How do I fail when a connection has no mock yet?

The run only reports what the agent happened to call. To fail on a connection
nobody has mocked, before any eval runs:

```yaml
- run: bunx eve info
- run: bunx eve-mocks list --json | jq -e '[.[] | select(.isConnection and .status == "blocked")] | length == 0'
```

### Why is there no colour in the CI log?

Colour is dropped when the output is not a terminal and when `NO_COLOR` is set.
The icons stay, so the summary reads the same.

<!-- /site:accordion -->
