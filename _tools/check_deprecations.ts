// Copyright 2023-2023 the Nifty li'l' tricks authors. All rights reserved. MIT license.

import * as colors from "std/fmt/colors.ts";
import { walk } from "std/fs/walk.ts";
import { join, toFileUrl } from "std/path/mod.ts";
import * as semver from "std/semver/mod.ts";
import { doc } from "x/deno_doc/mod.ts";
import { VERSION } from "../version.ts";

const EXTENSIONS = [".mjs", ".js", ".ts"];
const EXCLUDED_PATHS = [
  ".git",
  "_tools",
  "_util",
  "node_modules",
  "npm",
  "examples/nifty-lil-tricks-testing-nodejs",
  "scripts",
  "sandbox",
  "plugin_postgresql/client.ts",
  "examples/nestjs_.+test.ts",
  "plugin_nestjs",
];

const ROOT = new URL("../", import.meta.url);

const FAIL_FAST = Deno.args.includes("--fail-fast");

const DEPRECATION_IN_FORMAT_REGEX =
  /^\(will be removed in (?<version>\d+\.\d+\.\d+)\)/;
const DEPRECATION_AFTER_FORMAT_REGEX =
  /^\(will be removed after (?<version>\d+\.\d+\.\d+)\)/;

let shouldFail = false;

// add three minor version to current version
const DEFAULT_DEPRECATED_VERSION = semver.increment(
  semver.increment(semver.increment(VERSION, "minor")!, "minor")!,
  "minor",
);

const DEPRECATION_IN_FORMAT =
  `(will be removed in ${DEFAULT_DEPRECATED_VERSION})`;

for await (
  const { path } of walk(ROOT, {
    includeDirs: false,
    exts: EXTENSIONS,
    skip: EXCLUDED_PATHS.map((path) => new RegExp(path + "$")),
  })
) {
  // deno_doc only takes urls.
  const url = toFileUrl(path);
  const docs = await doc(url.href, {
    importMap: join(ROOT.href, "test_import_map.json"),
  });

  for (const d of docs) {
    const tags = d.jsDoc?.tags;
    if (tags) {
      for (const tag of tags) {
        switch (tag.kind) {
          case "deprecated": {
            const message = tag.doc;
            if (!message) {
              console.error(
                colors.red("Error"),
                `${
                  colors.bold("@deprecated")
                } tag must have a version: ${path}:${d.location.line}`,
              );
              shouldFail = true;
              if (FAIL_FAST) Deno.exit(1);
              continue;
            }
            const { version: afterVersion } =
              DEPRECATION_AFTER_FORMAT_REGEX.exec(message)?.groups || {};

            if (afterVersion) {
              if (
                semver.lt(semver.parse(afterVersion), semver.parse(VERSION))
              ) {
                console.warn(
                  colors.yellow("Warn"),
                  `${
                    colors.bold("@deprecated")
                  } tag is expired and export should be removed: ${path}:${d.location.line}`,
                );
              }
              continue;
            }

            const { version: inVersion } =
              DEPRECATION_IN_FORMAT_REGEX.exec(message)?.groups || {};
            if (!inVersion) {
              console.error(
                colors.red("Error"),
                `${
                  colors.bold(
                    "@deprecated",
                  )
                } tag version is missing. Append '${DEPRECATION_IN_FORMAT}' after @deprecated tag: ${path}:${d.location.line}`,
              );
              shouldFail = true;
              if (FAIL_FAST) Deno.exit(1);
              continue;
            }

            if (!semver.gt(semver.parse(inVersion), semver.parse(VERSION))) {
              console.error(
                colors.red("Error"),
                `${
                  colors.bold("@deprecated")
                } tag is expired and export must be removed: ${path}:${d.location.line}`,
              );
              if (FAIL_FAST) Deno.exit(1);
              shouldFail = true;
              continue;
            }
          }
        }
      }
    }
  }
}

if (shouldFail) Deno.exit(1);
