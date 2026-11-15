#!/usr/bin/env bash
# Atoms Demo 一键部署（Ubuntu 22.04/24.04，阿里云 ECS / 轻量应用服务器）
# 用法：
#   bash install-ecs.sh /opt/atoms-demo.zip              # 只装服务
#   bash install-ecs.sh /opt/atoms-demo.zip --with-nginx # 额外配 Nginx 反代 80 端口
# 说明：本脚本是幂等的，重复执行等于升级（会保留 DATA_DIR 里的数据）。
set -euo pipefail

ZIP_PATH="${1:-/opt/atoms-demo.zip}"
WITH_NGINX="${2:-}"

APP_DIR="/opt/atoms-demo"
DATA_DIR_PATH="/opt/atoms-demo-data"
WEB_PORT="3000"
AGENT_PORT="8100"
RUN_USER="$(id -un)"

info() { printf '\033[1;36m[info]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行：sudo bash $0 $*"
[[ -f "$ZIP_PATH" ]] || die "找不到部署包：$ZIP_PATH"

# ---------- 1. 基础依赖 ----------
info "安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl unzip ca-certificates python3 python3-venv python3-pip >/dev/null

# ---------- 2. Node.js 24（Next 16 与 node:sqlite 需要） ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 22 ]] && need_node=0
fi
if [[ $need_node -eq 1 ]]; then
  info "安装 Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
info "Node $(node -v) / Python $(python3 -V 2>&1 | awk '{print $2}')"

# ---------- 3. 解压代码（数据目录独立，升级不丢数据） ----------
# 包结构：client/（Next 产物） + server/（Python Agent） + contract/
info "解压到 $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR_PATH"
TMP_DIR="$(mktemp -d)"
unzip -q -o "$ZIP_PATH" -d "$TMP_DIR"
SERVER_JS="$(find "$TMP_DIR" -maxdepth 3 -name server.js | head -1)"
[[ -n "$SERVER_JS" ]] || die "压缩包里没找到 client/server.js"
PKG_DIR="$(dirname "$(dirname "$SERVER_JS")")"   # server.js 位于 <包>/client/ 下
# 保留 .env 与 server/.venv，其余覆盖
if [[ -f "$APP_DIR/.env" ]]; then cp "$APP_DIR/.env" "$TMP_DIR/keep.env"; fi
if [[ -d "$APP_DIR/server/.venv" ]]; then mv "$APP_DIR/server/.venv" "$TMP_DIR/keep-venv"; fi
rm -rf "$APP_DIR"/{client,server,contract,install-ecs.sh,START-HERE.txt,.env.example}
cp -a "$PKG_DIR"/. "$APP_DIR"/
if [[ -f "$TMP_DIR/keep.env" ]]; then cp "$TMP_DIR/keep.env" "$APP_DIR/.env"; fi
if [[ -d "$TMP_DIR/keep-venv" ]]; then mv "$TMP_DIR/keep-venv" "$APP_DIR/server/.venv"; fi
rm -rf "$TMP_DIR"

# ---------- 4. 配置文件 ----------
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  info "已生成 $APP_DIR/.env"
fi
set_kv() { # set_kv KEY VALUE  —— 有则改、无则加
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$APP_DIR/.env"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$APP_DIR/.env"
  else
    printf '%s=%s\n' "$key" "$val" >> "$APP_DIR/.env"
  fi
}
set_kv AGENT_URL "http://127.0.0.1:${AGENT_PORT}"
set_kv DATA_DIR "$DATA_DIR_PATH"
set_kv PORT "$WEB_PORT"

if grep -qE '^DEEPSEEK_API_KEY=$' "$APP_DIR/.env"; then
  warn "检测到 DEEPSEEK_API_KEY 为空：服务会以「离线演示模式」运行（功能可体验，但不是真实生成）"
  warn "填法：vi $APP_DIR/.env  然后 systemctl restart atoms-web atoms-agent"
fi

# ---------- 5. Python Agent 依赖 ----------
info "安装 Agent 依赖（server/.venv）"
if [[ ! -x "$APP_DIR/server/.venv/bin/python" ]]; then
  python3 -m venv "$APP_DIR/server/.venv"
fi
"$APP_DIR/server/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/server/.venv/bin/pip" install -q -r "$APP_DIR/server/requirements.txt"

# ---------- 6. systemd：两个服务 ----------
info "写入 systemd 服务"
cat >/etc/systemd/system/atoms-agent.service <<UNIT
[Unit]
Description=Atoms Agent (Python/FastAPI)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${APP_DIR}/.env
Environment=AGENT_PORT=${AGENT_PORT}
ExecStart=${APP_DIR}/server/.venv/bin/python -m uvicorn agent.main:app --host 127.0.0.1 --port ${AGENT_PORT}
Restart=always
RestartSec=3
StandardOutput=append:/var/log/atoms-agent.log
StandardError=append:/var/log/atoms-agent.log

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/atoms-web.service <<UNIT
[Unit]
Description=Atoms Studio Web (Next.js standalone)
After=network.target atoms-agent.service
Wants=atoms-agent.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/client
EnvironmentFile=${APP_DIR}/.env
Environment=PORT=${WEB_PORT}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${APP_DIR}/client/server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/atoms-web.log
StandardError=append:/var/log/atoms-web.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/atoms-agent.log /var/log/atoms-web.log
systemctl daemon-reload
systemctl enable --now atoms-agent.service atoms-web.service >/dev/null
systemctl restart atoms-agent.service atoms-web.service

# ---------- 7. 可选 Nginx ----------
if [[ "$WITH_NGINX" == "--with-nginx" ]]; then
  info "配置 Nginx 反代 80 → ${WEB_PORT}（关闭缓冲，保证 SSE 流式不被攒批）"
  apt-get install -y -qq nginx >/dev/null
  cat >/etc/nginx/sites-available/atoms-demo <<'CONF'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 600s;
    }
}
CONF
  ln -sf /etc/nginx/sites-available/atoms-demo /etc/nginx/sites-enabled/atoms-demo
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null && systemctl reload nginx
fi

# ---------- 8. 自检 ----------
info "等待服务就绪"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo
echo "----- 自检 -----"
curl -fsS "http://127.0.0.1:${AGENT_PORT}/health" && echo
curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" && echo
echo "----------------"
IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || echo '<服务器公网IP>')"
echo
info "部署完成"
echo "  访问：http://${IP}$([[ "$WITH_NGINX" == "--with-nginx" ]] && echo '' || echo ":${WEB_PORT}")"
echo "  日志：tail -f /var/log/atoms-web.log /var/log/atoms-agent.log"
echo "  数据：${DATA_DIR_PATH}/atoms.db（备份这个目录即可）"
echo "  注意：安全组需放行 $([[ "$WITH_NGINX" == "--with-nginx" ]] && echo 80 || echo ${WEB_PORT}) 端口"
