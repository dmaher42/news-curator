import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // Static export for GitHub Pages
  images: {
    unoptimized: true, // Required for static export
  },
  basePath: '/news-curator',
};

export default nextConfig;
