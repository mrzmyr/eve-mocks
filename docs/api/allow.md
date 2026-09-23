# allow

Let requests to one real upstream through while `--mocks` is on. Import it from `eve-mocks` and default-export it from `mocks/<name>.ts`.

```ts
// mocks/ai-gateway.ts
import { allow } from "eve-mocks";

// Evals need a real model.
export default allow({ url: "https://ai-gateway.vercel.sh/" });
```

## Parameters

| Name | |
| --- | --- |
| `url` | URL prefix that may be reached. A path, whenever the eval allows it. |

One file per allowed upstream, with a comment that says why. The file name is its name in `list` and in the run summary, and `git grep "allow("` finds everything that can reach production.

A mock for the same URL wins. Every other call throws: [Allow](../allow.md).
