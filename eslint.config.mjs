import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ADR-0001: src/domain is framework-free, pure TypeScript.
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*", "react", "react-dom"], message: "src/domain must not depend on the UI framework." },
            { group: ["@prisma/*", "@/generated/*", "@/server/*", "@/app/*"], message: "src/domain must not touch the database or server layer." },
          ],
        },
      ],
    },
  },
  // ADR-0002: tenant data goes through forSalon(); the unscoped client is allow-listed.
  {
    files: ["src/**/*.{ts,tsx}"],
    // Allow-listed: the client itself, platform jobs that work across salons (dispatcher, daily jobs,
    // inbound webhook routing), auth, health check and integration tests.
    ignores: [
      "src/domain/**", // has its own stricter rule above; a second block would replace it
      "src/server/db.ts",
      "src/server/platform/**",
      "src/server/auth/**",
      "src/server/**/*.int.test.ts",
      "src/app/api/health/route.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/db", importNames: ["unscopedDb"], message: "Use forSalon(salonId) for tenant data (ADR-0002)." },
            { name: "@/generated/prisma/client", importNames: ["PrismaClient"], message: "Import the client from @/server/db." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "coverage/**"]),
]);

export default eslintConfig;
