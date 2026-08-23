import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    // `.claude/worktrees` holds whole checkouts of this repo, so a bare
    // `vitest run` collected a second copy of the suite and reported close to
    // double the real figures — a green run that says 1137 tests when 589 ran.
    // Nothing under `.claude` is this project's own test. The defaults are
    // spread back in because naming `exclude` replaces them, and dropping
    // `node_modules` from the list would be a far worse sweep than the one
    // being fixed.
    exclude: [...defaultExclude, "**/.claude/**"],
  },
});
