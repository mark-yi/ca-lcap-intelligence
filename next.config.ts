import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd()
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /chromadb/,
        message: /Critical dependency: the request of a dependency is an expression/
      }
    ];
    return config;
  }
};

export default nextConfig;
