/** Commands `eve-mocks help <command>` knows, in the order the overview lists them. */
export const COMMANDS = ["list", "info", "add", "pull", "init", "help"] as const;

/** A command of the CLI, not counting the `--` wrapper. */
export type Command = (typeof COMMANDS)[number];

/** Whether `value` names a command. */
export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * The overview `eve-mocks --help` prints. It states the output and exit-code
 * contract in full, since a coding agent reads this instead of the README.
 */
export const OVERVIEW = `eve-mocks: in-process upstream mocks for eve agents

Usage
  eve-mocks [--dir <path>] -- <command> [--mocks]   run a command; upstreams are mocked
                                                    when the command carries --mocks
  eve-mocks <command> [options]

Commands
  list            every eve connection and upstream, and what a call to it does
  info            versions, paths, and counts, to check the setup
  add <name>      scaffold mocks/<name>.ts for an eve connection
  pull [name]     refresh schema files from the real upstreams
  init            create the mocks folder and wrap the app's eve scripts
  help [command]  this text, or the help of one command

Run options, in the wrapped command or before --
  --mocks                 turn the mocks on; without it the command runs untouched
  --no-fail-on-blocked    let a run pass although a call was blocked (default: exit 1)

Global options
  --dir <path>    mocks directory (default: mocks)
  --json          JSON on stdout (list, info); with it, any error is JSON on stderr
  -h, --help      help for eve-mocks or for the command before it
  -v, --version   print the version

Sign-ins
  A Vercel Connect token request and any OAuth 2.0 token request (grant_type in
  the body) are answered with a mock token when no mock or allow entry claims
  them, so connections need no mock for their token endpoint.

Output
  stdout holds the result only; hints, warnings, and errors go to stderr.
  Colour is dropped for NO_COLOR and when stdout is not a terminal.

Run report
  Each run under --mocks writes .eve-mocks/report.json:
    { command, startedAt, exitCode, counts: { mocked, allowed, blocked },
      targets: [{ outcome, target, calls, tools? }], log }
  tools counts MCP tools/call by tool name. log is the call log of that run, one
  JSON object per line; the last 10 are kept. The folder ignores itself in git.

Exit codes
  0    success
  1    the command failed, or a run made a blocked call; stderr says why and the fix
  2    wrong usage: unknown command, unknown option, or a missing argument
  127  the wrapped command could not start
  n    under \`--\`, otherwise the exit code of the wrapped command

Examples
  eve-mocks list --json | jq '.[] | select(.status == "blocked")'
  eve-mocks add linear && eve-mocks pull linear --header "Authorization: Bearer $TOKEN"
  eve-mocks -- eve eval --mocks

Run eve-mocks help <command> for the details of one command.`;

/** Help of each command, as `eve-mocks <command> --help` prints it. */
export const COMMAND_HELP: Readonly<Record<Command, string>> = {
  list: `eve-mocks list [--dir <path>] [--json]

What a call to each upstream does under --mocks:
  mocked    a mock answers
  allowed   an allow() entry lets it reach the real upstream
  blocked   neither, so the call throws

Rows come in two groups: the app's eve connections, then the mocks and allow
entries that match none of them, such as a token endpoint. Connections are read
from eve's compiled manifest; run \`eve info\` once when it is missing.

Options
  --json   one JSON array on stdout, each row:
           { name, status, url?, type?, isConnection, isDynamic }
           url is absent for a dynamic connection whose URL could not be read
           type is "mcp" or "http"; absent for an allow entry

Examples
  eve-mocks list
  eve-mocks list --json | jq -e '[.[] | select(.isConnection and .status == "blocked")] | length == 0'`,

  info: `eve-mocks info [--dir <path>] [--json]

The setup eve-mocks sees: its version, the runtime, the mocks directory, eve's
compiled manifest, and how many upstreams are mocked, allowed, and blocked.
Nothing is changed. Exits 0 even when a part is missing; read \`problems\`.

Options
  --json   one JSON object on stdout:
           { version, runtime, mocksDir, manifest, eve, counts, problems }

Examples
  eve-mocks info
  eve-mocks info --json | jq '.problems'`,

  add: `eve-mocks add <name> [--dir <path>]

Write mocks/<name>.ts for the eve connection <name>, with its production URL and
protocol (mcp or openapi) filled in. Never overwrites a file. A dynamic
connection works when its module constructs the URL while it loads; otherwise
write the mock by hand.

Examples
  eve-mocks list          # find the names that are blocked
  eve-mocks add linear`,

  pull: `eve-mocks pull [name] [--dir <path>] [--header "Name: value"]...

Refresh the schema files of one mock, or of every mock that has something
remote to pull: an OpenAPI spec URL, or an MCP server's tools/list. This is the
only command that calls a real upstream. Run it on your machine and commit
mocks/schemas/; CI then needs neither the upstreams nor their credentials.

Options
  --header "Name: value"   auth for a protected upstream, repeatable. Needs
                           [name]: a token goes to one upstream, never to all

Examples
  eve-mocks pull
  eve-mocks pull linear --header "Authorization: Bearer $LINEAR_TOKEN"`,

  init: `eve-mocks init [--dir <path>]

Create the mocks directory and route the app's \`dev\` and \`eval\` scripts in
package.json through \`eve-mocks --\`. Safe to rerun: existing files and already
wrapped scripts are left alone.

Examples
  eve-mocks init
  eve-mocks init --dir test/mocks`,

  help: `eve-mocks help [command]

Print the overview, or the help of one command. Same as --help.`,
};
