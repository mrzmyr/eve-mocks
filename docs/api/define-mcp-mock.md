# defineMcpMock

Mock a hosted MCP server from its pulled `tools/list` and a result per tool. Import it from `eve-mocks` and default-export it from `mocks/<name>.ts`.

```ts
// mocks/linear.ts
import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://mcp.linear.app/mcp",
  results: {
    get_issue: (args) => ({ identifier: String(args.id), title: "Checkout fails on retry" }),
    list_teams: () => ({ teams: [{ id: "team_1", name: "Platform" }] }),
  },
});
```

## Parameters

| Name | |
| --- | --- |
| `url` | Production MCP endpoint to intercept. `eve-mocks pull` reads `tools/list` from it. |
| `results` | One answer per tool. The function receives the call's arguments and returns the JSON the tool answers with. |

The mock lists only the tools that have a result, so a read-only agent never sees `create_issue` unless you add it. Every key must name a tool in the pulled schema; a typo fails before the agent starts. Names, descriptions, and input schemas come from that file, so the model reads the same text as in production.

The file name is the mock's name in `list` and in the run summary. The server is stateless: [Constraints](../constraints.md#mcp-mocks-are-stateless). How the file fits the run: [Mocks](../mocks.md).
