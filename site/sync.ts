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
    title: "Getting started",
    description: "Six steps from an agent that calls production to an eval that runs offline.",
  },
  {
    source: "docs/defining-mocks.md",
    slug: "defining-mocks",
    title: "Defining mocks",
    description: "MCP and HTTP mocks, spec forms, token endpoints, allowed upstreams, and the checks before a run.",
  },
  {
    source: "docs/schemas.md",
    slug: "schemas",
    title: "Schema files",
    description: "Refresh a mock's schema with pull, scaffold one with add, and authenticate a protected upstream.",
  },
  {
    source: "docs/ci.md",
    slug: "ci",
    title: "Run in CI",
    description: "The workflow, the secrets you still need, the coverage gate, and the run report.",
  },
  {
    source: "docs/cli.md",
    slug: "cli",
    title: "CLI",
    description: "Every command, --json output, exit codes, and what coding agents can rely on.",
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

/**
 * Turn the README's `<!-- site:… -->` regions into blume components. On GitHub
 * the markers are invisible and the regions read as plain Markdown; MDX does
 * not parse HTML comments, so every marker has to be gone afterwards.
 * See https://useblume.dev/docs/content/components
 */
function toComponents({ markdown }: { readonly markdown: string }): string {
  let out = markdown;

  // The prompt is the body of the region's code fence. A JS string keeps its
  // line breaks and backticks: the component copies the slot's `textContent`.
  out = out.replaceAll(
    /<!-- site:prompt (.+?) -->[\s\S]*?```text\n([\s\S]*?)```\s*<!-- \/site:prompt -->/g,
    (_match, description: string, prompt: string) => {
      return `<Prompt description=${JSON.stringify(description)} actions={["copy", "cursor"]}>\n  {${JSON.stringify(prompt.trim())}}\n</Prompt>`;
    },
  );

  out = out.replaceAll(/<!-- site:filetree -->\n([\s\S]*?)<!-- \/site:filetree -->/g, (_match, list: string) => {
    return `<FileTree>\n\n${list.trim()}\n\n</FileTree>`;
  });

  // Each `### 1. Title` of the region becomes a step; the component numbers them.
  out = out.replaceAll(/<!-- site:steps -->\n([\s\S]*?)<!-- \/site:steps -->/g, (_match, region: string) => {
    const steps = region
      .split(/^### (?:\d+\. )?/m)
      .slice(1)
      .map((step) => {
        const [title = "", ...body] = step.split("\n");

        return `<Step title=${JSON.stringify(title.trim())}>\n\n${body.join("\n").trim()}\n\n</Step>`;
      });

    return `<Steps>\n\n${steps.join("\n\n")}\n\n</Steps>\n`;
  });

  return out;
}

/** Drop the first heading: the page title is rendered from the front matter. */
function dropTitle({ markdown }: { readonly markdown: string }): string {
  return markdown.replace(/^#\s.*\n+/, "");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const page of PAGES) {
  const markdown = readFileSync(join(ROOT, page.source), "utf8");
  const body = toComponents({ markdown: toRoutes({ markdown: dropTitle({ markdown }) }) });
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
