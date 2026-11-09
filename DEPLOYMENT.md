# VPS deployment (Paper Trading only)

This guide runs the bot continuously with systemd on Ubuntu/Debian. The supplied service deliberately forces **PAPER_TRADING=true** and binds the dashboard/WebSocket to **127.0.0.1**. It is not a live-trading deployment.

## 1. VPS requirements

- Ubuntu 22.04/24.04 or Debian 12
- 1 vCPU and 2 GB RAM recommended
- SSH access and Git
- An LLM provider API key if you want automatic AI analysis; the bot can still collect public market data without one.

Do not use GitHub Actions as the 24/7 host. Actions runners are temporary CI machines.

## 2. Install Node.js and Git

Install Node.js 22 LTS using the official Node.js installation instructions for your distribution, then verify:

```bash
node --version
npm --version
git --version
```

Node must be version 18 or newer.

## 3. Create a restricted service account and fetch the reviewed branch

The Pull Request is still a draft and is not merged into `main`. For a controlled Paper Trading test, deploy the safety branch:

```bash
sudo adduser --system --group --home /opt/kraken-bot krakenbot
sudo git clone --branch safety/fail-closed-trading-lock https://github.com/tominsbot991/kraken-bot.git /opt/kraken-bot
sudo chown -R krakenbot:krakenbot /opt/kraken-bot
sudo -u krakenbot npm --prefix /opt/kraken-bot install --omit=dev
```

If the repository is private, configure a deploy key or use authenticated Git over SSH instead of putting a token in the clone URL.

## 4. Configure the LLM (optional)

Create a root-owned environment file. Never commit API keys or put them in GitHub source files.

```bash
sudo install -d -m 700 /etc/kraken-bot
sudo nano /etc/kraken-bot/kraken-bot.env
sudo chmod 600 /etc/kraken-bot/kraken-bot.env
sudo chown root:root /etc/kraken-bot/kraken-bot.env
```

Example contents:

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=PASTE_YOUR_KEY_ON_THE_SERVER
LLM_MODEL=YOUR_SUPPORTED_MODEL
AI_ENABLED=true
ANALYSIS_INTERVAL_MINUTES=30
PAPER_INITIAL_EUR=1000
PAPER_FEE_RATE=0.0026
PAPER_SLIPPAGE_BPS=5
```

Replace the placeholder with a model supported by your provider. Do not paste API keys into ChatGPT or commit them. No Kraken API key is needed in Paper Trading mode.

The service sets `PAPER_TRADING=true` in its own systemd environment. Keep it that way. Do not set `HOST=0.0.0.0`.

## 5. Install the systemd service

```bash
sudo install -m 644 /opt/kraken-bot/.deploy/kraken-bot.service /etc/systemd/system/kraken-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now kraken-bot
sudo systemctl status kraken-bot
```

View logs:

```bash
sudo journalctl -u kraken-bot -f
```

The virtual portfolio is persisted in `/opt/kraken-bot/data/paper_trading.json`. Back up the whole `data/` directory securely. Do not delete that file unless you intentionally want to reset the virtual account.

## 6. Firewall: keep the dashboard private

The dashboard and WebSocket listen only on `127.0.0.1:8000`. Do not open TCP port 8000 to the internet. On a fresh VPS with SSH already configured:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw deny 8000/tcp
sudo ufw enable
sudo ufw status
```

Connect to the dashboard from your own computer using an SSH tunnel:

```bash
ssh -N -L 8000:127.0.0.1:8000 YOUR_LINUX_USER@YOUR_VPS_IP
```

While that SSH session is open, visit `http://127.0.0.1:8000` in your browser. The same-origin API and WebSocket travel through the tunnel. Do not put the dashboard behind a public reverse proxy without adding proper authentication, CSRF protection, and WebSocket authentication first.

## 7. Updates and rollback

Before updating, back up `data/`. Fetch and review code changes, then restart:

```bash
cd /opt/kraken-bot
sudo systemctl stop kraken-bot
sudo -u krakenbot git fetch origin
sudo -u krakenbot git checkout safety/fail-closed-trading-lock
sudo -u krakenbot git pull --ff-only
sudo -u krakenbot npm install --omit=dev
sudo systemctl start kraken-bot
sudo journalctl -u kraken-bot -n 100 --no-pager
```

## Safety limits

- This service is intentionally Paper Trading only. It does not authorize real trades.
- The simulated portfolio uses live public prices, but fills, fees, slippage, and liquidity are only approximations. It is not evidence of future profitability.
- The dashboard is private only while the service remains bound to localhost and port 8000 is not exposed.
- Before any live deployment, separately review order execution, emergency cancellation, AI command permissions, dashboard authentication, logs, API-key permissions, and risk limits. Use a Kraken key with **no withdrawal permission**.
