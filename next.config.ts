import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 产出自包含的运行目录 .next/standalone（ECS 部署只传这个目录 + node_modules 已内联）
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
  // 部署产物与数据目录不进 standalone（否则每次打包都会把上一版自己拷进去）
  outputFileTracingExcludes: {
    "*": ["./dist/**", "./data/**", "./scripts/.shots/**", "./scripts/.out/**"],
  },
};

export default nextConfig;
