/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Hardcode the backend URL here as a fallback so rewrites always work
  // even if .env.local isn't loaded yet.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },

  async rewrites() {
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
