// Copyright 2023-2023 the Nifty li'l' tricks authors. All rights reserved. MIT license.

import { parse } from "std/flags/mod.ts";
import { dirname, fromFileUrl, join } from "std/path/mod.ts";
import { parse as parseSemver } from "std/semver/mod.ts";
import { build, BuildOptions, emptyDir } from "x/dnt/mod.ts";
import { SpecifierMappings } from "x/dnt/transform.ts";
import { VERSION } from "../version.ts";

const { _: [pkgToBuild] } = parse(Deno.args);

await emptyDir("./npm");

const __dirname = dirname(fromFileUrl(import.meta.url));
const rootDir = join(__dirname, "..");

interface Package {
  name: string;
  description: string;
  dir: string;
  tags: string[];
  test?: boolean;
  mappings?: SpecifierMappings;
}

const packages: Package[] = [
  {
    name: "@nifty-lil-tricks/testing",
    description:
      "A selection of useful utilities (or nifty li'l tricks!) for all things testing",
    dir: rootDir,
    tags: [],
  },
  {
    name: "@nifty-lil-tricks/testing-plugin-postgresql",
    description:
      "A nifty li'l plugin for setting up PostgreSQL database instances when testing",
    dir: join(rootDir, "plugin_postgresql"),
    tags: ["postgresql"],
    test: false,
    mappings: {
      "https://deno.land/x/nifty_lil_tricks_testing@__VERSION__/mod.ts": {
        name: "@nifty-lil-tricks/testing",
        version: `^${parseSemver(VERSION).major}.0.0`,
      },
    } as SpecifierMappings,
  },
];

let filteredPackages = packages;
if (pkgToBuild) {
  filteredPackages = packages.filter((pkg) => pkg.name === pkgToBuild);
  if (filteredPackages.length === 0) {
    throw new Error(`Could not find package ${pkgToBuild}`);
  }
}

async function rmBuildDir(dir: string) {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Do nothing
  }
}

for (const pkg of filteredPackages) {
  const outDir = join(rootDir, "./npm", pkg.name);
  Deno.chdir(pkg.dir);
  await rmBuildDir(outDir);
  const mappings: SpecifierMappings = {};
  const deps: Record<string, string> = {};
  for (const [name, mapping] of Object.entries(pkg.mappings ?? {})) {
    mappings[name] = typeof mapping === "string" ? mapping : mapping.name;
    if (typeof mapping !== "string" && mapping.version) {
      deps[mapping.name] = mapping.version;
    }
  }
  const options: BuildOptions = {
    entryPoints: [join(pkg.dir, "./mod.ts")],
    outDir,
    shims: {
      deno: true,
    },
    rootTestDir: pkg.dir,
    testPattern: "*.test.ts",
    packageManager: "npm",
    mappings,
    package: {
      // package.json properties
      name: pkg.name,
      version: VERSION,
      description: pkg.description,
      author: "Jonny Green <hello@jonnydgreen.com>",
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/jonnydgreen/nifty-lil-tricks-testing.git",
      },
      bugs: {
        url: "https://github.com/jonnydgreen/nifty-lil-tricks-testing/issues",
      },
      homepage: "https://github.com/jonnydgreen/nifty-lil-tricks-testing",
      keywords: [
        "testing",
        "deno",
        "nodejs",
        ...pkg.tags,
      ],
      engines: {
        node: ">=18",
      },
    },
    async postBuild() {
      // steps to run after building and before running the tests
      await Deno.copyFile(
        join(rootDir, "LICENSE"),
        join(outDir, "LICENSE"),
      );
      await Deno.copyFile(
        join(rootDir, ".npmrc"),
        join(outDir, ".npmrc"),
      );
      await Deno.copyFile(
        join(pkg.dir, "README.md"),
        join(outDir, "README.md"),
      );
    },
  };

  // Build and test
  if (pkg.test !== false) {
    await build({
      ...options,
      test: true,
      mappings: undefined,
      importMap: join(rootDir, "test_import_map.json"),
    });
    await rmBuildDir(outDir);
  }

  // Build for publish
  await build({
    ...options,
    typeCheck: false,
    test: false,
  });
  await adjustPackageJson(pkg, outDir);
}

// Cleanup to ensure the uploaded artifacts do not include node_modules
for (const pkg of packages) {
  const outDir = join(rootDir, "./npm", pkg.name);
  await Deno.remove(join(outDir, "node_modules"), { recursive: true });
}

async function adjustPackageJson(pkg: Package, outDir: string): Promise<void> {
  const path = join(outDir, "package.json");
  const rawPackageJson = await Deno.readTextFile(path);
  const packageJson = JSON.parse(rawPackageJson);
  const deps: Record<string, string> = {};
  for (const mapping of Object.values(pkg.mappings ?? {})) {
    if (typeof mapping !== "string" && mapping.version) {
      deps[mapping.name] = mapping.version;
    }
  }
  packageJson.dependencies = {
    ...packageJson.dependencies,
    ...deps,
  };
  await Deno.writeTextFile(path, JSON.stringify(packageJson, null, 2));
}
