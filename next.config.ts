import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The PDF renderer runs a real headless Chrome (see src/app/api/pdf). Both
   * packages ship native/binary assets that must NOT be traced and bundled by
   * the compiler — @sparticuz/chromium in particular resolves a ~50MB brotli
   * archive from its own package directory at runtime, which only works while
   * it stays an external require.
   */
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  async redirects() {
    return [
      // /settings was the account page until it grew into "My Account".
      // Kept permanently: the privacy policy pointed users there for the
      // right-to-erasure control, so old bookmarks and links must still land.
      { source: "/settings", destination: "/my-account", permanent: true },
    ];
  },
};

export default nextConfig;
