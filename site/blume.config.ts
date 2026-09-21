import { defineConfig } from "blume";

// `github` is left out on purpose: `sync.ts` generates `content/` from the
// README and `docs/`, and `content/` is gitignored, so "Edit this page" would
// 404. `navigation.repo` alone puts the repository link in the header.
export default defineConfig({
  title: "eve-mocks",
  description: "Mocks for eve agents",
  // The mark is the ❅ the CLI prints before its name. `public/icon.svg` is the
  // same mark as the favicon, which blume picks up by file name.
  logo: "/logo.svg",
  content: { root: "content" },
  navigation: { repo: "https://github.com/mrzmyr/eve-mocks" },
  lastModified: true,
  deployment: { site: "https://eve-mocks.vercel.app" },
});
