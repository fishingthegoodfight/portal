import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16's eslint-config-next is native flat config (no FlatCompat), and
// ignores build output by default — listed explicitly here so it's visible.
// .next/** covers .next/dev, where `next dev` writes in Next 16; the old
// 15.x config didn't know about it, so `npm run lint` linted generated code.
// See node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
