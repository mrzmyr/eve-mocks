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
  /** File name without an extension. `index` is the landing page. */
  readonly slug: string;
  /**
   * Sidebar group. It becomes a parenthesized folder, which groups pages
   * without adding a URL segment. See https://useblume.dev/docs/content/navigation
   */
  readonly group?: string;
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
    source: "docs/mocks.md",
    slug: "mocks",
    title: "Mocks",
    description: "Mock an MCP server or an HTTP API, and keep its schema next to it.",
  },
  {
    source: "docs/authentication.md",
    slug: "authentication",
    title: "Authentication",
    description: "Sign-ins are answered for you. Here is how, and the one exception.",
  },
  {
    source: "docs/allow.md",
    slug: "allow",
    title: "Allow",
    description: "Let a real upstream through, and what happens to every other call.",
  },
  {
    source: "docs/cli.md",
    slug: "cli",
    title: "CLI",
    description: "Every command, --json output, exit codes, and what coding agents can rely on.",
  },
  {
    source: "docs/faq.md",
    slug: "faq",
    group: "Reference",
    title: "FAQ",
    description: "The six cases the basics do not cover.",
  },
  {
    source: "docs/ci.md",
    slug: "ci",
    group: "Reference",
    title: "Run in CI",
    description: "One job, no services to start. The questions that come up are answered below.",
  },
  {
    source: "docs/constraints.md",
    slug: "constraints",
    group: "Reference",
    title: "Constraints",
    description: "What eve-mocks does not mock, and why.",
  },
];

/** Folder of a group: `Guides` becomes `(guides)`. */
function getFolder({ group }: { readonly group: string }): string {
  return `(${group.toLowerCase()})`;
}

/**
 * Rewrite the repository's relative `.md` links to site routes. Source file
 * names are unique, so a link resolves by its file name wherever it points
 * from: `docs/guides/ci.md`, `../faq.md`, and `faq.md#x` all work.
 */
function toRoutes({ markdown }: { readonly markdown: string }): string {
  const routes = new Map(
    PAGES.map(({ source, slug }) => {
      let route = `/${slug}`;

      if (slug === "index") {
        route = "/";
      }

      return [source.split("/").at(-1), route];
    }),
  );

  const out = markdown.replaceAll(/\]\((?:[\w./-]*\/)?([\w-]+\.md)(#[^)]*)?\)/g, (match, name: string, anchor = "") => {
    const route = routes.get(name);

    if (route === undefined) {
      return match;
    }

    return `](${route}${anchor})`;
  });

  // The example lives on GitHub, not on the site.
  return out.replaceAll("(example)", "(https://github.com/mrzmyr/eve-mocks/tree/main/example)");
}

const ESC = "\u001B[";

/** Wrap `text` in an ANSI style, as the CLI's `styleText` does. */
function paint({ text, code }: { readonly text: string; readonly code: number }): string {
  return `${ESC}${code}m${text}${ESC}0m`;
}

/**
 * Colour the CLI output in the docs the way a terminal shows it. The README
 * keeps plain text, which is what GitHub can render; on the site a fence
 * without a language that holds CLI output becomes an `ansi` block, which
 * Shiki highlights from the escape codes. See https://shiki.style/languages#ansi
 */
function toAnsi({ markdown }: { readonly markdown: string }): string {
  // Fences are paired by walking the lines: a regex would pair one block's
  // closing fence with the next block's opening one.
  const out: string[] = [];
  let fence: { readonly opener: string; readonly body: string[] } | undefined;

  for (const line of markdown.split("\n")) {
    if (fence === undefined) {
      if (line.startsWith("```")) {
        fence = { opener: line, body: [] };
      } else {
        out.push(line);
      }

      continue;
    }

    if (line !== "```") {
      fence.body.push(line);
      continue;
    }

    const isOutput = fence.opener === "```" && /✓ mocked|→ allowed|✗ blocked|^eve-mocks/m.test(fence.body.join("\n"));

    if (isOutput) {
      out.push('```ansi title="Terminal"', ...fence.body.map((row) => paintLine({ line: row })), "```");
    } else {
      out.push(fence.opener, ...fence.body, "```");
    }

    fence = undefined;
  }

  return out.join("\n");
}

/** One line of CLI output with the terminal's colours. */
function paintLine({ line }: { readonly line: string }): string {
  return (
    line
      // Title of the run summary, and the section titles of `list`.
      .replace(/^(eve-mocks)(  .*)$/, (_m, title: string, rest: string) => {
        return paint({ text: title, code: 1 }) + paint({ text: rest, code: 2 });
      })
      .replace(/^(eve connections|other upstreams)$/, (_m, title: string) => {
        return paint({ text: title, code: 1 });
      })
      // The detail after a row's count, the report line, and the hints.
      .replace(/^(  .*\S\s+\d+)(   \S.*)$/, (_m, row: string, detail: string) => {
        return row + paint({ text: detail, code: 2 });
      })
      .replace(/^(  report\s+.*)$/, (_m, report: string) => {
        return paint({ text: report, code: 2 });
      })
      .replace(/( \(dynamic\))$/, (_m, note: string) => {
        return paint({ text: note, code: 2 });
      })
      .replace(/^(\s+)(why:|fix:)/, (_m, pad: string, label: string) => {
        return pad + paint({ text: label, code: 2 });
      })
      .replace(/^(eve-mocks:)/, (_m, prefix: string) => {
        return paint({ text: prefix, code: 31 });
      })
      .replaceAll("✓ mocked", paint({ text: "✓ mocked", code: 32 }))
      .replaceAll("→ allowed", paint({ text: "→ allowed", code: 33 }))
      .replaceAll("✗ blocked", paint({ text: "✗ blocked", code: 31 }))
  );
}

/**
 * A nested Markdown list as blume's `Tree`: an item that ends in `/` is a
 * folder, opened by default, and two spaces of indent are one level.
 */
function toTree({ list }: { readonly list: string }): string {
  const lines = list.split("\n").filter((line) => {
    return line.trim() !== "";
  });
  const out: string[] = ["<Tree>"];
  const open: number[] = [];

  for (const line of lines) {
    const depth = (line.length - line.trimStart().length) / 2;
    const name = line.trim().replace(/^- /, "");

    // A shallower or equal item closes the folders it is not inside of.
    while (open.length > depth) {
      open.pop();
      out.push(`${"  ".repeat(open.length + 1)}</Tree.Folder>`);
    }

    const pad = "  ".repeat(depth + 1);

    if (name.endsWith("/")) {
      out.push(`${pad}<Tree.Folder name=${JSON.stringify(name.slice(0, -1))} defaultOpen>`);
      open.push(depth);
    } else {
      out.push(`${pad}<Tree.File name=${JSON.stringify(name)} />`);
    }
  }

  while (open.length > 0) {
    open.pop();
    out.push(`${"  ".repeat(open.length + 1)}</Tree.Folder>`);
  }

  return [...out, "</Tree>"].join("\n");
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
      return `<Prompt description=${JSON.stringify(description)} actions={["copy"]}>\n  {${JSON.stringify(prompt.trim())}}\n</Prompt>`;
    },
  );

  out = out.replaceAll(/<!-- site:filetree -->\n([\s\S]*?)<!-- \/site:filetree -->/g, (_match, list: string) => {
    return toTree({ list });
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

  // Each `### Question` of the region becomes a collapsed item.
  out = out.replaceAll(/<!-- site:accordion -->\n([\s\S]*?)<!-- \/site:accordion -->/g, (_match, region: string) => {
    const items = region
      .split(/^### /m)
      .slice(1)
      .map((item) => {
        const [title = "", ...body] = item.split("\n");

        return `<AccordionItem title=${JSON.stringify(title.trim())}>\n\n${body.join("\n").trim()}\n\n</AccordionItem>`;
      });

    return `<Accordion>\n\n${items.join("\n\n")}\n\n</Accordion>\n`;
  });

  return out;
}

/** Drop the first heading: the page title is rendered from the front matter. */
function dropTitle({ markdown }: { readonly markdown: string }): string {
  return markdown.replace(/^#\s.*\n+/, "");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** Write a folder's `meta.ts`. */
function writeMeta({ dir, meta }: { readonly dir: string; readonly meta: Record<string, unknown> }): void {
  writeFileSync(join(dir, "meta.ts"), `import { defineMeta } from "blume";\n\nexport default defineMeta(${JSON.stringify(meta)});\n`);
}

const groups = [...new Set(PAGES.flatMap(({ group }) => group ?? []))];

for (const page of PAGES) {
  let dir = OUT;

  if (page.group !== undefined) {
    dir = join(OUT, getFolder({ group: page.group }));
    mkdirSync(dir, { recursive: true });
  }

  const markdown = readFileSync(join(ROOT, page.source), "utf8");
  const body = toAnsi({ markdown: toComponents({ markdown: toRoutes({ markdown: dropTitle({ markdown }) }) }) });
  const frontMatter = `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(page.description)}\n---\n\n`;

  writeFileSync(join(dir, `${page.slug}.mdx`), `${frontMatter}${body}`);
  console.log(`${page.slug}.mdx from ${page.source}`);
}

// Sidebar order: loose pages first, as written above, then each group.
writeMeta({
  dir: OUT,
  meta: {
    pages: PAGES.filter(({ group }) => {
      return group === undefined;
    }).map(({ slug }) => {
      return slug;
    }),
  },
});

for (const [order, group] of groups.entries()) {
  writeMeta({
    dir: join(OUT, getFolder({ group })),
    meta: {
      title: group,
      // Loose pages take the low numbers; a shared number falls back to alphabetical.
      order: 100 + order,
      pages: PAGES.filter((page) => {
        return page.group === group;
      }).map(({ slug }) => {
        return slug;
      }),
    },
  });
}
