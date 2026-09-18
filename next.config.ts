import type { NextConfig } from "next";

// The Server Actions CSRF check allow-lists the browser's `Origin` header —
// not `X-Forwarded-Host`, which is what actually carries the Codespaces
// forwarded domain (https://<codespace>-<port>.app.github.dev). Confirmed
// from the dev server's own diagnostic: opening the app through VS Code's
// local port-forward tunnel sends `Origin: http://localhost:3000`, while
// `X-Forwarded-Host` still gets stamped with the public forwarded domain by
// the Codespaces proxy — so both need to be allowed, since which one a given
// browser sends depends on how the app happens to be opened (the forwarded
// https URL directly vs. VS Code's local tunnel). Only added when actually
// running inside a Codespace (CODESPACES is set by the environment), so a
// real deployment never carries this allowance — see
// node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md.
const codespacesAllowedOrigins = process.env.CODESPACES
  ? [`*.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev"}`, "localhost:3000"]
  : undefined;

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    serverActions: {
      allowedOrigins: codespacesAllowedOrigins,
    },
  },
};

export default nextConfig;
