# Schema files: `pull` and `add`

Reference. For the workflow, see the [README](../README.md).

```sh
eve-mocks pull            # refresh every schema file that has a remote upstream
eve-mocks pull notion     # one mock
eve-mocks add catalog     # scaffold mocks/catalog.ts from eve's manifest
```

`pull` writes into `mocks/schemas/`. One failing upstream does not stop the
others.

- **REST**: downloads every URL in the mock's `spec`. A public spec needs
  nothing else, and a local path is skipped: it is read in place.
- **MCP**: runs the official
  [MCP inspector](https://github.com/modelcontextprotocol/inspector) through
  `npx` and saves its `tools/list`. The inspector does the OAuth sign-in hosted
  servers require: the first pull in a terminal opens the browser, the token
  lands in `~/.mcp-inspector`, and later pulls reuse it, from an agent or CI too.

Auth for a protected upstream comes from `--header`, from the mock file, or
both; the flag wins. `--header` needs a mock name, so a token goes to one
upstream and never to all of them:

```sh
eve-mocks pull events --header "x-api-key: $SECRET"
eve-mocks pull pager --header "Authorization: Bearer $TOKEN"
```

```ts
defineHttpMock({
  url: "https://events.example.com/",
  spec: "https://events.example.com/openapi.json",
  headers: async () => ({ "x-api-key": process.env.SECRET ?? "" }),
});
```

`headers` is sent by `pull` only, never to a mocked request. It must be
self-contained: read the environment, do not import app code. When auth is missing, the error says which of the two to use:

```
tracker                  failed: tools/list failed for https://tracker.example.com/mcp
  fix: The server uses OAuth. Run eve-mocks pull tracker once in a terminal to sign in through the browser; …

events                  failed: OpenAPI spec download failed for https://…/openapi.json
  fix: Check the spec URL. If the spec is protected, pass its auth header: eve-mocks pull <name> --header "Name: value" …
```

`add` knows a static connection's protocol and URL from the manifest, and a
dynamic connection's from its module (see [dynamic connections](how-it-works.md#dynamic-connections)). For a dynamic
connection that shows no URL in `list`, write the mock by hand.
