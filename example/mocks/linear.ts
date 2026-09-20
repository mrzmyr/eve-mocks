import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://mcp.linear.app/mcp",
  // The schema file also has `create_issue`. It has no result, so the mock
  // does not list it: a read-only connection never allows the mutation.
  results: {
    get_issue: (args) => {
      return { identifier: String(args.id), title: "Checkout fails on retry" };
    },
  },
});
