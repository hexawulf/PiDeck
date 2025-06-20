# PiDeck System Monitor

## Overview

PiDeck is a full-stack web application designed for monitoring and managing system resources, services, and logs. Built with a modern tech stack, it provides a dashboard interface for real-time system monitoring, Docker container management, PM2 process monitoring, cron job management, and log viewing capabilities. The application features a clean, dark-themed UI optimized for system administration tasks.

## System Architecture

The application follows a monorepo structure with a clear separation between client and server code:

- **Frontend**: React-based SPA using Vite for build tooling
- **Backend**: Express.js REST API server
- **Database**: PostgreSQL with Drizzle ORM
- **UI Framework**: Shadcn/ui components with Tailwind CSS
- **Authentication**: Session-based with in-memory storage (development)
- **Development Environment**: Configured for Replit with hot reload

## Key Components

### Backend Architecture
- **Express Server**: RESTful API with middleware for logging and error handling
- **Authentication Service**: Password-based login with bcrypt hashing
- **System Service**: Collects system metrics (CPU, memory, temperature, network)
- **Storage Layer**: Drizzle ORM with PostgreSQL schema for users and sessions
- **Session Management**: Express-session with memory store for development

### Frontend Architecture
- **React + TypeScript**: Component-based UI with type safety
- **Routing**: Wouter for client-side navigation
- **State Management**: TanStack Query for server state and caching
- **UI Components**: Shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom theme variables
- **Forms**: React Hook Form with Zod validation

### Database Schema
- **Users Table**: ID, username, hashed password
- **Sessions Table**: Session ID, user ID, expiration timestamp
- **Types**: SystemInfo, LogFile, DockerContainer, PM2Process, CronJob interfaces

## Data Flow

1. **Authentication Flow**:
   - User submits password → Server validates against admin user → Session created → Client redirected to dashboard

2. **System Monitoring Flow**:
   - Dashboard loads → Multiple API calls for system data → Real-time updates every 5-10 seconds → Data cached by React Query

3. **Service Management Flow**:
   - User triggers action (restart container, etc.) → API mutation → Server executes system command → UI updates with new status

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connector
- **drizzle-orm**: Type-safe ORM for database operations
- **bcrypt**: Password hashing for authentication
- **express-session**: Session management middleware
- **@tanstack/react-query**: Server state management
- **wouter**: Lightweight routing for React

### UI Dependencies
- **@radix-ui/***: Accessible UI component primitives
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Component variant styling
- **lucide-react**: Icon library

### Development Dependencies
- **vite**: Build tool and dev server
- **tsx**: TypeScript execution for server
- **esbuild**: Fast bundler for production builds

## Deployment Strategy

### Development Environment
- **Replit Integration**: Configured with `.replit` file for automatic setup
- **Hot Reload**: Vite dev server with Express backend proxy
- **Database**: PostgreSQL module provisioned automatically
- **Port Configuration**: Server runs on port 5000, exposed as port 80

### Production Build
- **Frontend**: Vite builds optimized bundle to `dist/public`
- **Backend**: esbuild bundles server code to `dist/index.js`
- **Deployment**: Autoscale deployment target on Replit
- **Environment**: Production mode with NODE_ENV=production

### Configuration Files
- **drizzle.config.ts**: Database migration configuration
- **vite.config.ts**: Frontend build configuration with path aliases
- **tsconfig.json**: TypeScript configuration for monorepo
- **tailwind.config.ts**: Styling configuration with custom theme

## Changelog
```
Changelog:
- June 20, 2025: Initial PiDeck v1.0.0 development completed
- June 20, 2025: Full documentation suite created for GitHub
- June 20, 2025: Authentication system fixed and tested
- June 20, 2025: Repository prepared for GitHub sync
```

## User Preferences
```
Preferred communication style: Simple, everyday language.
```