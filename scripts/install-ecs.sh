#!/usr/bin/env bash
# Atoms Demo · 阿里云 ECS 一键安装/更新脚本（Ubuntu 22.04 / 24.04）
#
# 用法（root 身份）：
#   bash install-ecs.sh                      # 首次安装，上传包放在 /opt/atoms-demo.zip
#   bash install-ecs.sh /root/atoms-demo.zip # 指定包路径
#   bash install-ecs.sh --with-nginx         # 顺带装 Nginx 反代到 80 端口
#   bash install-ecs.sh --port 8080          # 改端口（默认 3000）
#   bash install-ecs.sh --update             # 更新：只换代码，保留 .env 与 data/
#
# Windows 上传的 .sh 可能带 CRLF，报 "bad interpreter" 时先执行：
#   sed -i 's/\r$//' install-ecs.sh
#
set -euo pipefail

APP_DIR=/opt/atoms-demo
DATA_DIR_PATH=/opt/atoms-demo-data   # 数据放在代码目录之外，换代码不会碰它
ZIP=""
PORT=3000
WITH_NGINX=0
MODE=install

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-nginx) WITH_NGINX=1; shift ;;
    --update)     MODE=update; shift ;;
    --port)       PORT="$2"; shift 2 ;;
    -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
    *)            ZIP="$1"; shift ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行（sudo -i 后重跑）"

# ---------- 1. 依赖 ----------
say "检查系统依赖"
command -v curl >/dev/null || { apt-get update -qq; apt-get install -y curl; }
command -v unzip >/dev/null || { apt-get update -qq; apt-get install -y unzip; }
ok "curl / unzip 就绪"

NODE_OK=0
if command -v node >/dev/null; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)
  if [[ "$NODE_MAJOR" -gt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -ge 5 ]]; }; then
    NODE_OK=1
    ok "Node $(node -v) 满足要求（>= 22.5，node:sqlite 依赖）"
  else
    echo "  当前 Node $(node -v) 过低，将安装 Node 24"
  fi
fi
if [[ $NODE_OK -eq 0 ]]; then
  say "安装 Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
  ok "Node $(node -v) 安装完成"
fi

# ---------- 2. 找到并解压运行包 ----------
if [[ -z "$ZIP" ]]; then
  for c in /opt/atoms-demo.zip /root/atoms-demo.zip ./atoms-demo.zip; do
    [[ -f "$c" ]] && ZIP="$c" && break
  done
fi
[[ -n "$ZIP" && -f "$ZIP" ]] || die "找不到运行包，请先 scp dist/atoms-demo.zip 到 /opt/，或用参数指定路径"
ok "运行包：$ZIP ($(du -h "$ZIP" | cut -f1))"

NEW_DIR=/opt/atoms-demo-new
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"
unzip -q -o "$ZIP" -d "$NEW_DIR"
# zip 内可能多一层 atoms-demo/
SRC="$NEW_DIR"
[[ -f "$NEW_DIR/atoms-demo/server.js" ]] && SRC="$NEW_DIR/atoms-demo"
[[ -f "$SRC/server.js" ]] || die "包里没有 server.js，确认打包用的是 node scripts/pack.mjs"

# ---------- 3. 落盘（保留 .env 与 data） ----------
say "部署代码到 $APP_DIR"
mkdir -p "$APP_DIR"
if [[ -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env" "$SRC/.env"
  ok "沿用已有 .env"
else
  cp "$SRC/.env.example" "$SRC/.env"
  echo
  echo "  请输入 DeepSeek API Key（直接回车 = 用离线演示模式，之后可手动填 $APP_DIR/.env）："
  read -r -s KEY || true
  if [[ -n "${KEY:-}" ]]; then
    sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=${KEY}|" "$SRC/.env"
    ok "已写入 DEEPSEEK_API_KEY"
  else
    ok "跳过，稍后编辑 .env 即可启用真实模型"
  fi
  echo
fi
# 数据目录放在代码目录之外：换代码 / 回滚都不会动数据
mkdir -p "$DATA_DIR_PATH"
if [[ -z "$(ls -A "$DATA_DIR_PATH" 2>/dev/null || true)" && -d "$APP_DIR/data" ]]; then
  cp -a "$APP_DIR/data/." "$DATA_DIR_PATH/" 2>/dev/null || true
  ok "已把旧的 ./data 迁移到 $DATA_DIR_PATH"
fi
grep -q '^DATA_DIR=' "$SRC/.env" || echo "DATA_DIR=$DATA_DIR_PATH" >> "$SRC/.env"
sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR_PATH|" "$SRC/.env"
chmod 600 "$SRC/.env"

# 保留旧目录做回滚点
if [[ -d "$APP_DIR" && $MODE == update ]]; then
  rm -rf /opt/atoms-demo-old
  mv "$APP_DIR" /opt/atoms-demo-old 2>/dev/null || true
fi
rm -rf "$APP_DIR"
mv "$SRC" "$APP_DIR"
mkdir -p "$APP_DIR/data"
rm -rf "$NEW_DIR"
ok "代码已就位：$APP_DIR"

# ---------- 4. systemd ----------
say "配置 systemd 常驻服务"
cat >/etc/systemd/system/atoms-demo.service <<EOF
[Unit]
Description=Atoms Demo (Next.js standalone)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/atoms-demo.log
StandardError=append:/var/log/atoms-demo.log

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable atoms-demo >/dev/null 2>&1 || true
systemctl restart atoms-demo
sleep 3
systemctl is-active --quiet atoms-demo && ok "服务已启动（端口 $PORT）" || die "服务启动失败，查看：journalctl -u atoms-demo -n 50"

# ---------- 5. Nginx（可选） ----------
if [[ $WITH_NGINX -eq 1 ]]; then
  say "安装 Nginx 反代到 80"
  command -v nginx >/dev/null || { apt-get install -y nginx >/dev/null; }
  cat >/etc/nginx/sites-available/atoms-demo <<EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE 流式生成必须关闭缓冲，否则退化成一次性返回
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/atoms-demo /etc/nginx/sites-enabled/atoms-demo
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  ok "Nginx 已反代 80 → $PORT"
fi

# ---------- 6. 自检 ----------
say "自检"
sleep 1
HEALTH=$(curl -s --max-time 15 "http://127.0.0.1:$PORT/api/health" || echo "")
[[ -n "$HEALTH" ]] || die "健康检查无响应，查看：journalctl -u atoms-demo -n 50 或 /var/log/atoms-demo.log"
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"mode":"live"' \
  && ok "模型已接通（live）" \
  || ok "当前是离线演示模式（demo）—— 填好 $APP_DIR/.env 里的 DEEPSEEK_API_KEY 后 systemctl restart atoms-demo"

IP=$(curl -s --max-time 8 https://api.ipify.org || echo "<公网IP>")
say "完成"
if [[ $WITH_NGINX -eq 1 ]]; then
  echo "  访问： http://$IP/"
else
  echo "  访问： http://$IP:$PORT/    ← 安全组需放行 $PORT"
fi
echo "  日志： journalctl -u atoms-demo -f"
echo "  更新： bash install-ecs.sh /opt/atoms-demo.zip --update"
echo "  回滚： rm -rf $APP_DIR && mv /opt/atoms-demo-old $APP_DIR && systemctl restart atoms-demo"
