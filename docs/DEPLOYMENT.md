# PiDeck Deployment Guide

Quick deployment instructions for various environments.

## Local Development

```bash
git clone https://github.com/hexawulf/PiDeck.git
cd PiDeck
npm install
npm run dev
```

Access at http://localhost:5000 with password: `admin`

## Production on Raspberry Pi

### Prerequisites
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2
```

### Deploy Application
```bash
# Clone and setup
git clone https://github.com/hexawulf/PiDeck.git
cd PiDeck
npm ci --only=production

# Build for production
npm run build

# Create logs directory
sudo mkdir -p /home/zk/logs
sudo chown $USER:$USER /home/zk/logs

# Start with PM2
pm2 start dist/index.js --name pideck
pm2 save
pm2 startup
```

### NGINX Reverse Proxy (Optional)
```bash
# Install NGINX
sudo apt install nginx -y

# Create site config
sudo tee /etc/nginx/sites-available/pideck << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/pideck /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL with Let's Encrypt
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

## Docker Deployment

```bash
# Build image
docker build -t pideck .

# Run container
docker run -d \
  --name pideck \
  -p 5000:5000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /home/zk/logs:/home/zk/logs \
  pideck
```

## Environment Variables

Create `.env` file:
```bash
NODE_ENV=production
PORT=5000
SESSION_SECRET=your-secure-secret-here
```

## Security Considerations

- Change default admin password
- Use HTTPS in production
- Configure firewall rules
- Restrict network access as needed
- Regular security updates

## Monitoring

Check application status:
```bash
pm2 status
pm2 logs pideck
curl http://localhost:5000/api/auth/me
```

For detailed installation instructions, see [docs/INSTALL.md](./INSTALL.md)