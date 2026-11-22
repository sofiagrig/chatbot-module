import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Files are uploaded in 3 MB chunks (Vercel caps a request at 4.5 MB).
      bodySizeLimit: "4mb",
    },
  },
  serverExternalPackages: ["exceljs", "mammoth", "unpdf"],
};

export default nextConfig;
