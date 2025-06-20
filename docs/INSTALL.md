# PiDeck Installation Guide

Complete installation guide for setting up PiDeck on Linux systems, including development and production configurations.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [NGINX Configuration](#nginx-configuration)
- [Systemd Service](#systemd-service)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements
- **Operating System**: Ubuntu 20.04+ / Debian 11+ / Raspberry Pi OS
- **Memory**: Minimum 1GB RAM (2GB+ recommended)
- **Storage**: 500MB free disk space
- **Network**: Internet connection for package installation

### Required Software

#### Node.js and npm
```bash
# Update package list
sudo apt update

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x or higher
npm --version   # Should show 8.x.x or higher
```

#### Git
```bash
sudo apt install git -y
```

#### Optional Dependencies

##### Docker (for container management)
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Start Docker service
sudo systemctl enable docker
sudo systemctl start docker
```

##### PM2 (for process management)
```bash
# Install PM2 globally
sudo npm install -g pm2

# Setup PM2 startup script
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME
```

## Development Setup

### 1. Clone Repository
```bash
# Clone the repository
git clone https://github.com/hexawulf/PiDeck.git
cd PiDeck

# Or if you're starting fresh
mkdir PiDeck && cd PiDeck
git init
```

### 2. Install Dependencies
```bash
# Install all dependencies
npm install

# Install development dependencies
npm install --save-dev
```

### 3. Environment Configuration

Create environment file (optional):
```bash
# Create .env file
cat > .env << EOF
NODE_ENV=development
PORT=5006
SESSION_SECRET=your-secure-session-secret-here
EOF
```

### 4. Create Log Directory
```bash
# Create logs directory
sudo mkdir -p /home/zk/logs
sudo chown $USER:$USER /home/zk/logs

# Create sample log files for testing
echo "Sample log entry $(date)" > /home/zk/logs/sample.log
echo "Another log entry $(date)" > /home/zk/logs/app.log
```

### 5. Start Development Server
```bash
# Start the development server
npm run dev

# The application will be available at:
# http://localhost:5006
```

### 6. Access the Dashboard
1. Open your browser to `http://localhost:5006`
2. Login with password: `admin`
3. Navigate through the different sections

## Production Deployment

### 1. Prepare Production Environment

#### Create Dedicated User
```bash
# Create pideck user
sudo useradd -m -s /bin/bash pideck
sudo mkdir -p /home/pideck/logs
sudo chown pideck:pideck /home/pideck/logs
```

#### Setup Application Directory
```bash
# Switch to pideck user
sudo su - pideck

# Clone repository
git clone https://github.com/hexawulf/PiDeck.git
cd PiDeck
```

### 2. Install Dependencies and Build
```bash
# Install production dependencies only
npm ci --only=production

# Build the application
npm run build
```

### 3. Environment Configuration
```bash
# Create production environment file
cat > .env << EOF
NODE_ENV=production
PORT=5006
SESSION_SECRET=$(openssl rand -base64 32)
EOF

# Secure the environment file
chmod 600 .env
```

### 4. Start with PM2
```bash
# Start the application with PM2
pm2 start dist/index.js --name pideck --env production

# Save PM2 configuration
pm2 save

# Check status
pm2 status
pm2 logs pideck
```

### 5. Setup PM2 Auto-restart
```bash
# Generate startup script
pm2 startup

# Follow the instructions shown by the command above
# It will show you a command to run with sudo
```

## NGINX Configuration

### 1. Install NGINX
```bash
sudo apt update
sudo apt install nginx -y
```

### 2. Create Site Configuration
```bash
# Create NGINX configuration
sudo tee /etc/nginx/sites-available/pideck << EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Rate limiting
    location / {
        proxy_pass http://localhost:5006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Serve static files directly
    location /static/ {
        alias /home/pideck/PiDeck/dist/public/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF
```

### 3. Enable Site and SSL
```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/pideck /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart NGINX
sudo systemctl restart nginx

# Optional: Setup SSL with Let's Encrypt
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

## Systemd Service

### 1. Create Systemd Service File
```bash
sudo tee /etc/systemd/system/pideck.service << EOF
[Unit]
Description=PiDeck Admin Dashboard
After=network.target

[Service]
Type=simple
User=pideck
WorkingDirectory=/home/pideck/PiDeck
Environment=NODE_ENV=production
Environment=PORT=5006
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=pideck

[Install]
WantedBy=multi-user.target
EOF
```

### 2. Enable and Start Service
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable pideck

# Start service
sudo systemctl start pideck

# Check status
sudo systemctl status pideck

# View logs
sudo journalctl -u pideck -f
```

## Firewall Configuration

### UFW (Ubuntu Firewall)
```bash
# Allow SSH (important!)
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

## Backup and Maintenance

### 1. Database Backup Script
```bash
# Create backup script
sudo tee /usr/local/bin/pideck-backup.sh << EOF
#!/bin/bash
BACKUP_DIR="/backup/pideck"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Backup configuration
tar -czf \$BACKUP_DIR/pideck_config_\$DATE.tar.gz /home/pideck/PiDeck/.env

# Backup logs
tar -czf \$BACKUP_DIR/pideck_logs_\$DATE.tar.gz /home/pideck/logs/

# Keep only last 7 days of backups
find \$BACKUP_DIR -name "pideck_*" -mtime +7 -delete

echo "Backup completed: \$DATE"
EOF

# Make executable
sudo chmod +x /usr/local/bin/pideck-backup.sh
```

### 2. Setup Cron Job for Backups
```bash
# Add to crontab
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/pideck-backup.sh") | crontab -
```

## Troubleshooting

### Common Issues

#### 1. Port 5006 Already in Use
```bash
# Find process using port 5006
sudo lsof -i :5006

# Kill the process if needed
sudo kill -9 <PID>
```

#### 2. Permission Denied for Logs
```bash
# Fix log directory permissions
sudo chown -R pideck:pideck /home/pideck/logs
sudo chmod 755 /home/pideck/logs
```

#### 3. Docker Commands Fail
```bash
# Add user to docker group
sudo usermod -aG docker pideck

# Restart session or reboot
sudo systemctl restart pideck
```

#### 4. PM2 Commands Not Found
```bash
# Install PM2 globally
sudo npm install -g pm2

# Or add to PATH
export PATH=$PATH:/usr/local/bin
```

### Logs and Debugging

#### Application Logs
```bash
# PM2 logs
pm2 logs pideck

# Systemd logs
sudo journalctl -u pideck -f

# NGINX logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

#### Health Check
```bash
# Check if application is running
curl http://localhost:5006/api/auth/me

# Check system resources
htop
df -h
free -h
```

### Performance Optimization

#### 1. Node.js Memory Limits
```bash
# Set NODE_OPTIONS in environment
export NODE_OPTIONS="--max_old_space_size=1024"
```

#### 2. PM2 Cluster Mode
```bash
# Start in cluster mode
pm2 start dist/index.js --name pideck -i max
```

#### 3. NGINX Caching
Add to NGINX configuration:
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Security Hardening

### 1. Change Default Password
After first login, update the admin password in the application or modify the hash in `server/storage.ts`.

### 2. Restrict Network Access
```bash
# Allow only local network access
sudo ufw allow from 192.168.1.0/24 to any port 80
sudo ufw allow from 192.168.1.0/24 to any port 443
```

### 3. Regular Updates
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Node.js dependencies
npm audit fix
```

## Support

If you encounter issues during installation:

1. Check the [GitHub Issues](https://github.com/hexawulf/PiDeck/issues)
2. Review application logs for error messages
3. Ensure all prerequisites are properly installed
4. Verify network connectivity and firewall settings

For additional help, please open an issue on GitHub with:
- Your operating system and version
- Node.js and npm versions
- Complete error messages
- Steps to reproduce the issue