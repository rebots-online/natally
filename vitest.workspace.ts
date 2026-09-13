import { existsSync, readdirSync } from "node:fs";
import { defineWorkspace } from "vitest/config";

const projects = ["apps", "packages"].flatMap((group) => {
  const directory = new URL(`${group}/`, import.meta.url);
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => `${group}/${entry.name}`);
});

// A workspace with no packages still needs a project for Vitest's no-tests success path.
export default defineWorkspace(
  projects.length > 0 ? projects : [{ test: { name: "workspace", include: [] } }],
);
