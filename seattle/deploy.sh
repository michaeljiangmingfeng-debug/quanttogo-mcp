#!/bin/bash
# QuantToGo MCP Server - Seattle Deployment Script
# Run as root on Debian 11
set -e

DOMAIN="mcp-us.quanttogo.com"
APP_DIR="/opt/mcp/quanttogo-mcp"
PORT=3100

echo "=== QuantToGo MCP Server - Seattle Deployment ==="

# ── 1. Install Node.js 18 via NodeSource ──
echo "[1/6] Installing Node.js 18..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
fi
echo "  Node: $(node -v), npm: $(npm -v)"

# ── 2. Install PM2 ──
echo "[2/6] Installing PM2..."
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi

# ── 3. Install nginx ──
echo "[3/6] Installing nginx..."
if ! command -v nginx &>/dev/null; then
  apt-get update
  apt-get install -y nginx
fi
systemctl enable nginx
systemctl start nginx

# ── 4. Deploy app ──
echo "[4/6] Deploying MCP server..."
mkdir -p $APP_DIR
cp server.js $APP_DIR/
cp package.json $APP_DIR/
cd $APP_DIR
npm install --production
echo "  Dependencies installed."

# ── 5. Start with PM2 ──
echo "[5/6] Starting with PM2..."
pm2 delete quanttogo-mcp 2>/dev/null || true
pm2 start server.js --name quanttogo-mcp
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
echo "  PM2 process started."

# ── 6. Configure nginx ──
echo "[6/6] Configuring nginx..."
cat > /etc/nginx/conf.d/mcp.conf << 'NGINX'
server {
    listen 80;
    server_name mcp-us.quanttogo.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 86400;
    }
}
NGINX

nginx -t && systemctl reload nginx
echo "  nginx configured."

echo ""
echo "=== Deployment complete! ==="
echo "HTTP:   http://$DOMAIN/health"
echo "MCP:    http://$DOMAIN/mcp"
echo ""
echo "Next steps:"
echo "  1. Add DNS A record: $DOMAIN -> $(curl -s ifconfig.me)"
echo "  2. Install SSL: certbot --nginx -d $DOMAIN"
echo "  3. Test: curl http://localhost:$PORT/health"
