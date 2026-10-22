/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  ...(process.env.DOCKER_BUILD ? { output: "standalone" } : {}),

  images: {
    unoptimized: true,
  },

  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "framer-motion",
    ],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

export default nextConfig;
