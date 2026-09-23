# CLI

```sh
eve-mocks --help             # every command, option, JSON shape, and exit code
eve-mocks <command> --help   # the details of one
eve-mocks --version
```

The help is written to be enough on its own, so a coding agent never has to
read this site.

## Commands

| Command | Does | More |
| --- | --- | --- |
| `eve-mocks -- <command> [--mocks]` | Run a command; upstreams are mocked when it carries `--mocks`. | [The wrapper](#the-wrapper) |
| `list` | Every eve connection and upstream, and what a call to it does. | [Dynamic connections](faq.md#list-shows-a-dynamic-connection-without-a-url-what-now) |
| `info` | Versions, paths, counts, and each problem with its fix. | [When something is off](#when-something-is-off) |
| `add <name>` | Scaffold `mocks/<name>.ts` and pull an MCP server's schema. Never overwrites. | [Dynamic connections](faq.md#list-shows-a-dynamic-connection-without-a-url-what-now) |
| `pull [name]` | Refresh schema files from the real upstreams. | [Protected upstreams](mocks.md#protected-upstreams) |
| `init` | Create the mocks folder and wrap the app's eve scripts. Safe to rerun. | [Getting started](../README.md) |
| `help [command]` | The overview, or the help of one command. Same as `--help`. | |

## Flags

- **`--dir <path>`** — mocks folder. Default `mocks`.
- **`--json`** — `list` and `info` only. Errors go to stderr so stdout stays
  parseable.
- **`--mocks`** — opt-in, on the wrapped command or before `--`. Without it the
  command runs untouched.
- **`--no-fail-on-block`** — let a run pass although a call was blocked.
  Default is exit 1: a model that recovers from the thrown error would
  otherwise hide the block. [Allow](allow.md), [CI](ci.md).
- **`--header "Name: value"`** — auth for `add` and `pull`, repeatable. Needs a mock
  name, so a token never goes to every upstream.
  [Protected upstreams](mocks.md#protected-upstreams).

## The wrapper

```sh
eve-mocks -- eve eval --mocks
```

Flags after `--` belong to the wrapped command; eve-mocks never reads them.
`--mocks` is what turns the mocks on.

Every run under `--mocks` writes `.eve-mocks/report.json` (always the latest)
and a timestamped copy in `.eve-mocks/runs/` (the last 10). The folder ignores
itself in git. Shape and call log:
[CI](ci.md#where-do-i-see-what-the-agent-called).

One block fails the run with exit 1 even when the wrapped command exited 0.
The summary: [Allow](allow.md).

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
{
  "error": {
    "status": 400,
    "message": "pull --header needs a mock name",
    "why": "Without a name every mock is pulled, and the header, usually a token, would be sent to each upstream",
    "fix": "Name the mock the header is for: eve-mocks pull <name> --header \"Name: value\""
  }
}
```

Every error carries `status`, `message`, `why`, and `fix`, printed as three
lines without `--json`.

`report.json` is a file, not stdout. See
[CI](ci.md#where-do-i-see-what-the-agent-called).

## Exit codes

| Code | Means |
| --- | --- |
| `0` | Success. |
| `1` | The command failed, or a run made a blocked call. |
| `2` | Wrong usage: unknown command, unknown option, or a missing argument. |
| `127` | The wrapped command could not start. |
| `n` | Under `--`, otherwise the wrapped command's own code. |

The exit code is the contract. `2` means the CLI was typed wrong: do not retry
the same args. `1` on a wrapped run can mean every eval passed and a block
still failed the job. To fail before any eval runs, when a connection still
has no mock: [CI](ci.md#how-do-i-fail-when-a-connection-has-no-mock-yet).

## Conventions

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

`info` changes nothing and exits 0 even when the setup is broken: each
problem is listed with its fix. Read `problems` when you use `--json`.

`list` and `add` cannot read a URL built inside `session.started`. Write that
mock by hand: [FAQ](faq.md#list-shows-a-dynamic-connection-without-a-url-what-now).

Known limits, such as sandbox traffic and clients that do not use `fetch`, are
in [Constraints](constraints.md).
