/**
 * Generate the docs site's content from the repository's own Markdown, so the
 * README and `docs/` stay the single source of truth.
 *
 * Run from `site/`: the output lands in `site/content/`, which is gitignored.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One page of the site, in sidebar order. */
type Page = {
  /** Source file, relative to the repository root. */
  readonly source: string;
  /** Route and file name, without an extension. `index` is the landing page. */
  readonly slug: string;
  /** Sidebar and metadata title. */
  readonly title: string;
  /** Meta description and search snippet. */
  readonly description: string;
};

const ROOT = join(import.meta.dirname, "..");
const OUT = join(import.meta.dirname, "content");

const PAGES: readonly Page[] = [
  {
    source: "README.md",
    slug: "index",
    title: "Overview",
    description: "Run an eve agent and its evals without credentials and without touching production.",
  },
  {
    source: "docs/defining-mocks.md",
    slug: "defining-mocks",
    title: "Defining mocks",
    description: "MCP and REST mocks, spec forms, token endpoints, allowed upstreams, and the checks before a run.",
  },
  {
    source: "docs/schemas.md",
    slug: "schemas",
    title: "Schema files",
    description: "Refresh a mock's schema with pull, scaffold one with add, and authenticate a protected upstream.",
  },
  {
    source: "docs/how-it-works.md",
    slug: "how-it-works",
    title: "How it works",
    description: "The preload, what happens to a request, list, dynamic connections, and the known constraints.",
  },
];

/** Rewrite the repository's relative links to site routes. */
function toRoutes({ markdown }: { readonly markdown: string }): string {
  let out = markdown;

  for (const { source, slug } of PAGES) {
    const name = source.replace(/^docs\//, "");
    const route = slug === "index" ? "/" : `/${slug}`;

    for (const link of [`(docs/${name})`, `(${name})`, `(../${name})`]) {
      out = out.replaceAll(link, `(${route})`);
    }
    // Anchors keep their fragment: (how-it-works.md#constraints) -> (/how-it-works#constraints)
    out = out.replaceAll(new RegExp(`\\((?:\\.\\./|docs/)?${name.replace(".", "\\.")}#`, "g"), `(${route}#`);
  }

  // The example lives on GitHub, not on the site.
  return out.replaceAll("(example)", "(https://github.com/mrzmyr/eve-mocks/tree/main/example)");
}

/** Drop the first heading: the page title is rendered from the front matter. */
function dropTitle({ markdown }: { readonly markdown: string }): string {
  return markdown.replace(/^#\s.*\n+/, "");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const page of PAGES) {
  const markdown = readFileSync(join(ROOT, page.source), "utf8");
  const body = toRoutes({ markdown: dropTitle({ markdown }) });
  const frontMatter = `---\ntitle: ${page.title}\ndescription: ${page.description}\n---\n\n`;

  writeFileSync(join(OUT, `${page.slug}.mdx`), `${frontMatter}${body}`);
  console.log(`content/${page.slug}.mdx from ${page.source}`);
}

// Sidebar order: the workflow first, then the references it links to.
const order = PAGES.map(({ slug }) => {
  return slug;
});

writeFileSync(
  join(OUT, "meta.ts"),
  `import { defineMeta } from "blume";\n\nexport default defineMeta({ pages: ${JSON.stringify(order)} });\n`,
);
console.log("content/meta.ts");
