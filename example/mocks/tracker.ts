import { defineMcpMock } from "eve-mocks";

export default defineMcpMock({
  url: "https://tracker.example.com/mcp",
  // A read-only connection never lists the mutation, so neither does the mock.
  omit: ["create_issue"],
  results: {
    get_issue: (args) => {
      return { identifier: String(args.id), title: "Checkout fails on retry" };
    },
  },
});
