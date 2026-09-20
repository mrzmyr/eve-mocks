import { defineConfig } from "blume";

// `github` is left out on purpose: the repository is private, so "Edit this
// page" would 404 for a visitor. Add it when the repository goes public.
export default defineConfig({
  title: "eve-mocks",
  description:
    "In-process upstream mocks for eve agents: run an agent and its evals without credentials and without touching production.",
  content: { root: "content" },
  deployment: { site: "https://eve-mocks.vercel.app" },
});
