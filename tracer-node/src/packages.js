/**
 * The libraries a snippet may require.
 *
 * Same rule as the Python image: what is installed here IS the dependency set.
 * The container has no network and no package manager at runtime, so a snippet
 * can require exactly what this file lists and nothing else. Adding a library
 * to the product means editing this list and rebuilding the image -- which is
 * the point, since every entry is code that runs beside untrusted snippets.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the curated modules live. Snippets run in a private temp directory, so
 * Node's directory walk would never find them; the child gets NODE_PATH set to
 * this instead.
 */
export const PACKAGES_DIR = process.env.VIZ_PACKAGES_DIR
  ?? path.resolve(here, "..", "node_modules");

const CURATED = ["lodash", "dayjs"];

let cached = null;

/** Names and versions of the curated packages actually present in the image. */
export function availablePackages() {
  if (cached) return cached;
  const require = createRequire(path.join(PACKAGES_DIR, "noop.js"));
  cached = CURATED.flatMap((name) => {
    try {
      const { version } = require(`${name}/package.json`);
      return [`${name} ${version}`];
    } catch {
      return []; // not installed in this image; simply not offered
    }
  });
  return cached;
}
