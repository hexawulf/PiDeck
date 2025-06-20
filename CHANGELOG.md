# Changelog

All notable changes to PiDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-20

### Added
- Initial release of PiDeck Admin Dashboard
- Real-time system monitoring (CPU, memory, temperature, network)
- System information display (hostname, OS, kernel, architecture, uptime)
- Log file viewer with real-time updates and auto-refresh
- Docker container management (start, stop, restart, status monitoring)
- PM2 process management and monitoring
- Cron job scheduler with manual execution capability
- Dark theme optimized for server administration
- Session-based authentication with bcrypt password hashing
- Responsive design for desktop and mobile devices
- RESTful API with Express.js backend
- React frontend with TypeScript and TailwindCSS
- Real-time data updates without page reload
- Tab-based navigation interface

### Security
- bcrypt password hashing for admin authentication
- Session-based authentication with HTTP-only cookies
- HTTPS-ready configuration for production deployment
- Localhost/LAN access restriction by default

### Technical
- Node.js/Express.js backend with TypeScript
- React 18 frontend with Vite build system
- TailwindCSS for styling with Shadcn/ui components
- TanStack Query for server state management
- Wouter for client-side routing
- Drizzle ORM with PostgreSQL support
- In-memory storage for development
- Shell command integration for system operations

[1.0.0]: https://github.com/hexawulf/PiDeck/releases/tag/v1.0.0