# 部署到阿里云 ECS（推荐路径）

本项目是 **Next.js 16（App Router）+ `node:sqlite` 文件持久化**，所以：

| 阿里云产品 | 是否适用 | 原因 |
|---|---|---|
| **ECS / 轻量应用服务器** | ✅ 推荐 | 有持久磁盘，SQLite 零改动直接跑；一条 `node server.js` 就起来 |
| 函数计算 FC | ⚠️ 要改造 | 无常驻磁盘，SQLite 落在 /tmp 会丢；需换 RDS，代码要加一个 PG 驱动 |
| SAE / Serverless 应用引擎 | ⚠️ 要改造 | 同上，实例随时重建 |

下面是 ECS 的完整步骤（Ubuntu 22.04 / 24.04 验证过的命令）。

---

## 0. 前置

- ECS 实例 ≥ 2C2G，系统盘 ≥ 20G，**公网 IP 已分配**
- 安全组入方向放行：`22`（SSH）、`3000`（直接测试）或 `80`（走 Nginx）
- ⚠️ 大陆节点用**域名 + 80/443** 需要域名已备案；**直接 IP:3000 不需要备案**

## 1. 装 Node 24（`node:sqlite` 要求 ≥ 22.5）

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 期望 v24.x
```

## 2. 上传运行包

本地（Windows PowerShell）：

```powershell
cd D:\workspace\projects\atoms-demo
node scripts/pack.mjs                     # 产出 dist/atoms-demo（39MB，自包含）
Compress-Archive -Path dist\atoms-demo -DestinationPath dist\atoms-demo.zip -Force
scp dist\atoms-demo.zip root@<ECS公网IP>:/opt/
```

服务器：

```bash
mkdir -p /opt/atoms-demo && cd /opt
apt-get install -y unzip && unzip -o atoms-demo.zip -d /opt
cd /opt/atoms-demo   # 里面应有 server.js / .next / node_modules / START-HERE.txt
```

## 3. 配环境变量（密钥只放服务器，不进仓库）

```bash
cd /opt/atoms-demo
cp .env.example .env
nano .env
#   DEEPSEEK_API_KEY=sk-...
#   LLM_BASE_URL=https://api.deepseek.com/v1
#   LLM_MODEL=deepseek-chat
#   DATA_DIR=/opt/atoms-demo/data
chmod 600 .env
```

> 不填密钥也能启动 —— 会自动进入**离线演示模式**（内置模板跑完整流水线），
> 适合先验证网络/端口，再填密钥验证真实生成。

## 4. 先用前台跑通，再挂守护进程

> **想一条命令搞定？** 上传 `atoms-demo.zip` 和 `scripts/install-ecs.sh` 到服务器后：
> ```bash
> bash install-ecs.sh /opt/atoms-demo.zip --with-nginx
> ```
> 它会自动装 Node 24、解压到 `/opt/atoms-demo`、交互式问你 API Key、写 systemd 常驻、反代 80、最后自检并打印访问地址。
> 数据固定放 `/opt/atoms-demo-data`（在代码目录之外，更新/回滚都不会动数据）。
> 更新发版用 `bash install-ecs.sh /opt/atoms-demo.zip --update`。

手动方式（便于排查）：

```bash
cd /opt/atoms-demo
PORT=3000 node server.js
# 另开一个终端：
curl -s localhost:3000/api/health
# 期望 {"ok":true,"mode":"live","model":"deepseek-chat","store":"sqlite:...","persistent":true}
```

浏览器打开 `http://<ECS公网IP>:3000` —— 到这里就已经是"可测试的在线链接"。

## 5. systemd 常驻（进程挂了自动拉起）

```bash
cat >/etc/systemd/system/atoms-demo.service <<'EOF'
[Unit]
Description=Atoms Demo (Next.js standalone)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/atoms-demo
EnvironmentFile=/opt/atoms-demo/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/atoms-demo/server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/atoms-demo.log
StandardError=append:/var/log/atoms-demo.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now atoms-demo
systemctl status atoms-demo --no-pager
curl -s localhost:3000/api/health
```

## 6. Nginx 反代（想用 80 端口 / 域名时）

**SSE 是关键**：不加 `proxy_buffering off`，流式生成会变成"一次性蹦出来"，演示效果全丢。

```bash
apt-get install -y nginx
cat >/etc/nginx/sites-available/atoms-demo <<'EOF'
server {
    listen 80;
    server_name _;          # 有备案域名就换成域名

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ↓↓ SSE 流式生成必须的三行 ↓↓
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/atoms-demo /etc/nginx/sites-enabled/atoms-demo
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 7. 数据与备份

- 数据库：`$DATA_DIR/atoms.db`（默认 `./data`），SQLite 单写者——**保持单实例**，不要多副本共享同一目录
- 备份：`sqlite3 data/atoms.db ".backup /opt/backup/atoms-$(date +%F).db"`（或直接 `cp` 停服后拷）
- 生成物源码全部在 `versions` 表里，换服务器只搬 `atoms.db` 即可

## 8. 更新发版

```powershell
# 本地
npm run build; node scripts/pack.mjs
Compress-Archive -Path dist\atoms-demo -DestinationPath dist\atoms-demo.zip -Force
scp dist\atoms-demo.zip root@<IP>:/opt/
```

```bash
# 服务器（注意：保留 .env 与 data）
cd /opt && rm -rf atoms-demo-new && unzip -o atoms-demo.zip -d atoms-demo-new
cp atoms-demo/.env atoms-demo-new/.env
mv atoms-demo atoms-demo-old && mv atoms-demo-new atoms-demo
systemctl restart atoms-demo && curl -s localhost:3000/api/health
```

## 9. 验收清单

```bash
curl -s localhost:3000/api/health          # ok=true, mode=live, persistent=true
curl -s localhost:3000/ | head -c 200       # 200 + HTML
# 浏览器：点模板 → 看是否逐 token 流式 → iframe 里真点几下 → 刷新页面看历史是否还在
```

> 排障：`journalctl -u atoms-demo -n 100` 或 `/var/log/atoms-demo.log`。
> 常见坑：① Node < 22.5 直接报 `node:sqlite` 不存在；② 安全组没放行端口（表现为超时而非拒绝）；
> ③ 加了 Nginx 但没关 buffering（流式变一次性）；④ `DATA_DIR` 指向只读目录导致启动即失败。
