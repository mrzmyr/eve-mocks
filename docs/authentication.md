# Authentication

Two separate things need credentials in production: the agent's connections at
run time, and `pull` when it reads a protected upstream. Under `--mocks` only
the second one ever needs a real credential.

## Token endpoints

Mock the endpoint that issues tokens, and every connection's real token code
still runs. No connection needs a mock branch, and CI needs no client secret.

```ts
// mocks/auth.ts
import { oauthToken, vercelConnect } from "eve-mocks";

export default [vercelConnect(), oauthToken({ url: "https://auth.example.com/oauth/token" })];
```

| Helper | Mocks |
| --- | --- |
| `vercelConnect()` | the [Vercel Connect](https://vercel.com/docs/connect) token endpoint |
| `oauthToken({ url })` | any OAuth 2.0 token endpoint; answers `access_token: "mock-token"` |

`init` creates the `vercelConnect()` mock for you, as `mocks/vercel-connect.ts`.

## Pull from a protected upstream

`pull` is the one command that calls a real upstream, and it runs on your
machine. How it signs in depends on the upstream.

**An MCP server with OAuth** needs nothing: the first pull opens the browser,
and later pulls reuse the token.

```sh
bun run mocks pull linear
```

**A static token** goes in `--header`. It needs the mock's name, so a token is
sent to one upstream and never to all of them:

```sh
bun run mocks pull events --header "Authorization: Bearer $TOKEN"
```

**To keep it out of the command line**, give the mock `headers`. They are sent
by `pull` only, never to a mocked request:

```ts
defineHttpMock({
  url: "https://events.example.com/",
  spec: "https://events.example.com/openapi.json",
  headers: async () => ({ "x-api-key": process.env.EVENTS_API_KEY ?? "" }),
});
```

When auth is missing, the error says which of these to use.
