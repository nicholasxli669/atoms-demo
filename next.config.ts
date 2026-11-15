import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 产出自包含的运行目录 .next/standalone（ECS 部署只传这个目录 + node_modules 已内联）
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
