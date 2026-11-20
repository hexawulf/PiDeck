// ESLint (flat config): recommended rule sets only, no stylistic rules.
//   all TypeScript   @eslint/js recommended + typescript-eslint recommended
//   client/src       + eslint-plugin-react-hooks recommended
// Plain .js/.mjs/.cjs files (build/migrate helpers in scripts/, test
// helpers, config files) are not linted.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      "dist/",
      "dist-dev/",
      "dist-e2e/",
      ".e2e/",
      "test-results/",
      "playwright-report/",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
]);
