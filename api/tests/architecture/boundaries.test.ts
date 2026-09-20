import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/// Each service touches only its own store: browsing reads Mongo, booking reads
/// Postgres (DECISIONS entry 4).
///
/// This is enforced by reading the code, not by running it. It walks every
/// import reachable from a service's routes and fails if one leads to the other
/// service's database. The rule was written down once before and quietly broken
/// by the code for weeks; a test is what stops that happening twice.

const SRC = path.resolve(__dirname, "../../src");

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/// Every module reachable from `entry`: project files by path, packages by name.
function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [path.join(SRC, entry)];

  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec.startsWith(".")) {
        // "@prisma/client" -> "@prisma/client", "node:os" -> "node:os"
        packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
        continue;
      }
      const base = path.resolve(path.dirname(file), spec);
      const resolved = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
      if (!resolved) throw new Error(`cannot resolve "${spec}" from ${file}`);
      stack.push(resolved);
    }
  }
  return { files, packages };
}

const rel = (files: Set<string>) => [...files].map((f) => path.relative(SRC, f).replace(/\\/g, "/"));

describe("store boundaries", () => {
  it("browsing never reaches Postgres", () => {
    const { files, packages } = reachable("routes/browsing.ts");

    expect(rel(files)).not.toContain("db/postgres.ts");
    expect([...packages]).not.toContain("@prisma/client");
    // And it does reach what it should, so the walk above is not vacuous.
    expect(rel(files)).toContain("models/catalog.ts");
  });

  it("booking never reaches Mongo", () => {
    for (const entry of ["routes/shows.ts", "routes/reservations.ts"]) {
      const { files, packages } = reachable(entry);

      expect(rel(files)).not.toContain("db/mongo.ts");
      expect(rel(files)).not.toContain("models/movie.ts");
      expect(rel(files)).not.toContain("models/catalog.ts");
      expect([...packages]).not.toContain("mongoose");
      expect(rel(files)).toContain("db/postgres.ts");
    }
  });

  it("the checker would catch a violation", () => {
    // app.ts composes both services, so it legitimately reaches both stores.
    // If the walk could not see that, the two tests above would prove nothing.
    const { files } = reachable("app.ts");
    expect(rel(files)).toEqual(expect.arrayContaining(["db/postgres.ts", "db/mongo.ts"]));
  });
});
