import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The navbar calls it "Pricing"; the page lives at /billing. Catch the URL
    // people will actually type.
    return [{ source: "/pricing", destination: "/billing", permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/(.*)\\.png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/(.*)\\.mp4',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
