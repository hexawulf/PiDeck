# PiDeck API Documentation

RESTful API documentation for PiDeck admin dashboard backend.

## Base URL

```
http://localhost:5006/api
```

## Authentication

All API endpoints (except auth endpoints) require session-based authentication.

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "password": "admin"
}
```

**Response:**
```json
{
  "message": "Login successful"
}
```

### Logout
```http
POST /api/auth/logout
```

**Response:**
```json
{
  "message": "Logout successful"
}
```

### Check Authentication Status
```http
GET /api/auth/me
```

**Response:**
```json
{
  "authenticated": true
}
```

## System Information

### Get System Info
```http
GET /api/system/info
```

**Response:**
```json
{
  "hostname": "raspberrypi",
  "os": "Ubuntu 24.10",
  "kernel": "6.8.0-1013-raspi",
  "architecture": "aarch64",
  "uptime": "2 days, 14 hours, 23 minutes",
  "cpu": 15.6,
  "memory": {
    "used": 1024,
    "total": 4096,
    "percentage": 25
  },
  "temperature": 42.5,
  "network": {
    "ip": "192.168.1.100",
    "status": "Connected"
  },
  "diskIO": {
    "readSpeed": 256,
    "writeSpeed": 128,
    "utilization": 5
  },
  "networkBandwidth": {
    "rx": 64,
    "tx": 32
  }
}
```

- **diskIO.readSpeed** – disk read speed in KiB/s.
- **diskIO.writeSpeed** – disk write speed in KiB/s.
- **diskIO.utilization** – disk utilization percentage.
- **networkBandwidth.rx** – receive rate in KiB/s.
- **networkBandwidth.tx** – transmit rate in KiB/s.

## Log Management

### Get Log Files
```http
GET /api/logs
```

**Response:**
```json
[
  {
    "name": "app.log",
    "path": "/home/zk/logs/app.log",
    "size": "2.5 KB"
  },
  {
    "name": "error.log",
    "path": "/home/zk/logs/error.log",
    "size": "1.2 KB"
  }
]
```

### Get Log File Content
```http
GET /api/logs/{filename}
```

**Response:**
```json
{
  "content": "2025-06-20 12:30:15 INFO Application started\n2025-06-20 12:30:16 INFO Server listening on port 5006\n..."
}
```

## Docker Management

### Get Docker Containers
```http
GET /api/docker/containers
```

**Response:**
```json
[
  {
    "id": "a1b2c3d4e5f6",
    "name": "webapp",
    "image": "nginx:latest",
    "status": "Up 2 hours",
    "state": "running"
  },
  {
    "id": "f6e5d4c3b2a1",
    "name": "database",
    "image": "postgres:13",
    "status": "Exited (0) 5 minutes ago",
    "state": "stopped"
  }
]
```

### Restart Container
```http
POST /api/docker/containers/{id}/restart
```

**Response:**
```json
{
  "message": "Container restarted successfully"
}
```

### Stop Container
```http
POST /api/docker/containers/{id}/stop
```

**Response:**
```json
{
  "message": "Container stopped successfully"
}
```

### Start Container
```http
POST /api/docker/containers/{id}/start
```

**Response:**
```json
{
  "message": "Container started successfully"
}
```

## PM2 Process Management

### Get PM2 Processes
```http
GET /api/pm2/processes
```

**Response:**
```json
[
  {
    "id": 0,
    "name": "app",
    "status": "online",
    "cpu": "5.2%",
    "memory": "125MB",
    "uptime": "2h"
  },
  {
    "id": 1,
    "name": "worker",
    "status": "stopped",
    "cpu": "0%",
    "memory": "0MB",
    "uptime": "0s"
  }
]
```

### Restart Process
```http
POST /api/pm2/processes/{name}/restart
```

**Response:**
```json
{
  "message": "Process restarted successfully"
}
```

### Stop Process
```http
POST /api/pm2/processes/{name}/stop
```

**Response:**
```json
{
  "message": "Process stopped successfully"
}
```

## Cron Job Management

### Get Cron Jobs
```http
GET /api/cron/jobs
```

**Response:**
```json
[
  {
    "schedule": "0 2 * * *",
    "command": "/usr/local/bin/backup.sh",
    "description": "Backup routine",
    "lastRun": "2025-06-20 02:00:00",
    "status": "Active"
  },
  {
    "schedule": "*/15 * * * *",
    "command": "/usr/local/bin/health-check.sh",
    "description": "Health check",
    "status": "Active"
  }
]
```

### Run Cron Job
```http
POST /api/cron/run
Content-Type: application/json

{
  "command": "/usr/local/bin/backup.sh"
}
```

**Response:**
```json
{
  "message": "Cron job executed successfully"
}
```

## Error Responses

### Authentication Required
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "message": "Authentication required"
}
```

### Invalid Input
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "message": "Invalid input",
  "errors": [
    {
      "field": "password",
      "message": "Password is required"
    }
  ]
}
```

### Server Error
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "message": "Internal server error"
}
```

## Rate Limiting

- **Authentication endpoints**: 5 requests per minute per IP
- **System info**: 60 requests per minute per session
- **Container/Process actions**: 10 requests per minute per session
- **Cron execution**: 5 requests per minute per session

## WebSocket Events (Future)

Future versions may include WebSocket support for real-time updates:

```javascript
// Example WebSocket connection
const ws = new WebSocket('ws://localhost:5006/api/ws');

ws.on('system-update', (data) => {
  console.log('System metrics updated:', data);
});
```

## SDK Examples

### JavaScript/Node.js
```javascript
class PiDeckAPI {
  constructor(baseURL = 'http://localhost:5006/api') {
    this.baseURL = baseURL;
    this.sessionCookie = null;
  }

  async login(password) {
    const response = await fetch(`${this.baseURL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'include'
    });
    return response.json();
  }

  async getSystemInfo() {
    const response = await fetch(`${this.baseURL}/system/info`, {
      credentials: 'include'
    });
    return response.json();
  }

  async restartContainer(id) {
    const response = await fetch(`${this.baseURL}/docker/containers/${id}/restart`, {
      method: 'POST',
      credentials: 'include'
    });
    return response.json();
  }
}
```

### Python
```python
import requests

class PiDeckAPI:
    def __init__(self, base_url='http://localhost:5006/api'):
        self.base_url = base_url
        self.session = requests.Session()

    def login(self, password):
        response = self.session.post(f'{self.base_url}/auth/login', 
                                   json={'password': password})
        return response.json()

    def get_system_info(self):
        response = self.session.get(f'{self.base_url}/system/info')
        return response.json()

    def restart_container(self, container_id):
        response = self.session.post(f'{self.base_url}/docker/containers/{container_id}/restart')
        return response.json()
```

### cURL Examples
```bash
# Login
curl -X POST http://localhost:5006/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "admin"}' \
  -c cookies.txt

# Get system info
curl -X GET http://localhost:5006/api/system/info \
  -b cookies.txt

# Restart container
curl -X POST http://localhost:5006/api/docker/containers/abc123/restart \
  -b cookies.txt
```