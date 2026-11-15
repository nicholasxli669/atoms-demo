# 阿里云 ECS 部署（Web + Python Agent）

适合：ECS 云服务器 / 轻量应用服务器，Ubuntu 22.04 或 24.04，1 核 2G 起步（模型调用走外部 API，本地只做编排）。

> 不选函数计算 FC / SAE 的原因：Web 用 `node:sqlite` 需要持久磁盘，Agent 是长连接 SSE，两者都更适合常驻进程。

## 一、打包（本地）

```powershell
npm --prefix apps/studio run build
node scripts/pack.mjs
# 产物：dist\atoms-demo\  内部包含 server.js / .next / node_modules / agent\ / contract\ / install-ecs.sh
Compress-Archive -Path dist\atoms-demo -DestinationPath dist\atoms-demo.zip -Force
```

`pack.mjs` 结尾会做自检（缺 `app-route-turbo.runtime.prod.js` 这类文件会在本地就失败，而不是上线后 500）。

## 二、上传并安装

```bash
scp dist/atoms-demo.zip root@<公网IP>:/opt/
ssh root@<公网IP>
bash /opt/atoms-demo.zip 2>/dev/null || true      # 只是提醒：zip 不能直接 bash
cd /opt && unzip -o atoms-demo.zip -d /opt/atoms-demo && cd /opt/atoms-demo
bash install-ecs.sh /opt/atoms-demo.zip --with-nginx
```

`install-ecs.sh` 会做：

1. 装 `curl unzip python3 python3-venv`，必要时装 Node 24（NodeSource）
2. 解压代码到 `/opt/atoms-demo`，**保留 `.env` 与 `agent/.venv`**（升级不丢配置）
3. 建 `agent/.venv` 并装 Python 依赖
4. 写两个 systemd 服务：

| 服务 | 监听 | 说明 |
|---|---|---|
| `atoms-agent.service` | `127.0.0.1:8100` | FastAPI，只允许本机访问 |
| `atoms-web.service` | `0.0.0.0:3000` | Next standalone（`node server.js`） |

5. 可选：装 Nginx 反代 80 → 3000，并关掉缓冲（`proxy_buffering off`），否则 SSE 会被攒批，页面表现为"生成过程不流式、最后一次性蹦出来"
6. 自检：`curl /health` 两个服务 + 打印访问地址

## 三、配置项（`/opt/atoms-demo/.env`）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 模型密钥；留空则进离线演示模式 |
| `LLM_BASE_URL` / `LLM_MODEL` | 任何 OpenAI 兼容端点，默认 DeepSeek |
| `AGENT_URL` | Web 找 Agent 的地址，默认 `http://127.0.0.1:8100`；删掉则回落内置流水线 |
| `PORT` | Web 端口，默认 3000 |
| `DATA_DIR` | SQLite 数据目录，安装脚本设为 `/opt/atoms-demo-data`（**在代码目录之外**，升级不会覆盖） |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | 可选，改用托管 libSQL |

改完配置：`systemctl restart atoms-web atoms-agent`。

## 四、验收

```bash
curl -s localhost:8100/health     # {"ok":true,...,"ready":true,"mode":"live"}
curl -s localhost:3000/api/health # {"ok":true,"mode":"live","store":"sqlite:...","persistent":true}
curl -s -N -X POST localhost:3000/api/generate -H 'content-type: application/json' \
  -d '{"message":"做一个记账工具"}'  # 应看到 SSE 逐条吐出，而不是最后一次性返回
```

浏览器打开 `http://<公网IP>`（或 `:3000`），安全组放行对应端口。

## 五、运维

```bash
tail -f /var/log/atoms-web.log /var/log/atoms-agent.log
systemctl status atoms-web atoms-agent
# 数据备份：/opt/atoms-demo-data/atoms.db（含 -wal/-shm）
```

注意：SQLite 单写者，Web **只能单实例**，不要用多台 ECS 共享同一个数据目录；要横向扩容得先换 Turso/RDS。
