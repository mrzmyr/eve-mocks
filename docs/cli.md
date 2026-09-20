# CLI



```sh
eve-mocks --help             # every command, option, JSON shape, and exit code
eve-mocks <command> --help   # the details of one
eve-mocks --version
```

The help is written to be enough on its own, so a coding agent never has to
read this site.

## Commands

| Command | Does |
| --- | --- |
| `eve-mocks -- <command> [--mocks]` | Run a command; upstreams are mocked when it carries `--mocks`. |
| `list` | Every eve connection and upstream, and what a call to it does. |
| `info` | Versions, paths, counts, and each problem with its fix. |
| `add <name>` | Scaffold `mocks/<name>.ts` for an eve connection. |
| `pull [name]` | Refresh schema files from the real upstreams. |
| `init` | Create the mocks folder and wrap the app's eve scripts. |

## Machine-readable output

`--json` makes `list` and `info` print one JSON value on stdout:

```sh
eve-mocks list --json | jq '.[] | select(.status == "block")'
```

```json
{ "name": "logs", "status": "block", "url": "https://logs.example.com/mcp", "type": "mcp", "isConnection": true, "isDynamic": true }
```

With `--json`, an error is JSON on stderr too, so stdout stays parseable:

```json
{ "error": { "status": 400, "message": "pull --header needs a mock name", "why": "…", "fix": "…" } }
```

Every error carries `status`, `message`, `why`, and `fix`, printed as three
lines without `--json`.

## Exit codes

| Code | Means |
| --- | --- |
| `0` | Success. |
| `1` | The command failed, or a run made a blocked call. |
| `2` | Wrong usage: unknown command, unknown option, or a missing argument. |
| `127` | The wrapped command could not start. |
| `n` | Under `--`, otherwise the wrapped command's own code. |

## Conventions

- **stdout holds the result only.** Hints, warnings, and errors go to stderr.
- **Flags after `--` belong to the wrapped command.** eve-mocks never reads them.
- **A mistyped command names the nearest one**: `eve-mocks lst` answers `Did you
  mean "list"?`.
- **npm, pnpm, and yarn work like bun.** Only the flag differs: `npm run eval --
  --mocks` needs the `--`, `bun run eval --mocks` does not.
- **The CLI runs on Node**, whichever package manager starts it, because that is
  what its shebang asks for. The command it wraps may run on Node or Bun.

## When something is off

```sh
eve-mocks info
```

```
eve-mocks     1.0.0
runtime       node v24.11.0
eve           0.47.6
mocks dir     /app/mocks (12 mocks, 3 allowed)
manifest      /app/.eve/compile/compiled-agent-manifest.json (version 45)
connections   ✓ mock 10  → allow 0  ✗ block 14
```

`info` changes nothing and exits 0 even when part of the setup is missing: each
problem is listed with its fix. Known limits, such as sandbox traffic and
clients that do not use `fetch`, are in
[Constraints](constraints.md).
