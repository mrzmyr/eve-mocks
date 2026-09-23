# oauthToken

Mock an OAuth 2.0 token endpoint, such as one that sends no `grant_type`. Import it from `eve-mocks` and default-export it from `mocks/<name>.ts`.

eve-mocks already answers a token request that sends `grant_type`. Export this when that answer should be a file you own. Why: [Authentication](../authentication.md#oauth).

```ts
// mocks/auth.ts
import { oauthToken } from "eve-mocks";

export default oauthToken({ url: "https://auth.example.com/token" });
```

## Parameters

| Name | |
| --- | --- |
| `url` | The provider's token endpoint. |

It answers `{ "access_token": "mock-token", "token_type": "Bearer", "expires_in": 86400 }`. For another shape, use [`defineHttpMock`](define-http-mock.md) with a route.
