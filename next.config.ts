import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
