import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore marks a parameter or binding kept on purpose
      // (a signature callers rely on, or a key dropped by rest destructuring).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Swapping <a> for <Link> turns full page loads into client-side
      // navigations, which is a behaviour change. Surface it, don't fail on it.
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "supabase/**",
      "public/**",
      ".claude/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
