# Exargen Command Center — Product Documentation

## Overview

Exargen Command Center is an enterprise-grade internal project management and productivity platform built for tracking development progress across multiple projects. It replaces daily standup meetings, status update calls, and scattered communication tools with a single unified platform.

**Tech Stack:** React 18 + Vite + Tailwind CSS (frontend) | Express + Prisma + PostgreSQL (backend) | TypeScript throughout

**Live URL:** `http://localhost:5174`

---

## Table of Contents

1. [Architecture](#architecture)
2. [Features by Role](#features-by-role)
3. [Core Features](#core-features)
4. [Sprint & Agile System](#sprint--agile-system)
5. [Daily Productivity](#daily-productivity)
6. [Analytics & Reporting](#analytics--reporting)
7. [Communication](#communication)
8. [Security](#security)
9. [API Reference](#api-reference)
10. [Database Schema](#database-schema)
11. [Setup & Deployment](#setup--deployment)

---

## Architecture

```
exargen-command-center/
├── backend/           # Express API server
│   ├── prisma/        # Schema + migrations
│   ├── src/
│   │   ├── config/    # Database, CORS, environment
│   │   ├── handlers/  # Route handlers (14 modules)
│   │   ├── middleware/ # Auth, RBAC, rate limiting, validation
│   │   ├── routes/    # Route definitions (14 endpoint groups)
│   │   ├── services/  # Business logic (14 service modules)
│   │   ├── validators/# Zod validation schemas
│   │   ├── utils/     # JWT, password, errors
│   │   └── seed/      # Database seeding
│   └── .env           # Environment configuration
│
├── frontend/          # React SPA
│   ├── public/        # Static assets (logo)
│   ├── src/
│   │   ├── api/       # Axios API clients (10 modules)
│   │   ├── components/# Reusable components
│   │   │   ├── auth/      # Can, ProtectedRoute, RoleRedirect
│   │   │   ├── charts/    # VelocityChart, HealthPieChart
│   │   │   ├── decisions/ # DecisionList
│   │   │   ├── kanban/    # KanbanBoard, KanbanColumn, SortableTaskCard
│   │   │   ├── layout/    # AppShell, Sidebar, TopBar
│   │   │   ├── notifications/ # NotificationBell
│   │   │   ├── productivity/  # Heatmap
│   │   │   ├── sprints/   # SprintBoard
│   │   │   ├── tasks/     # UnifiedTaskCard, TaskDetailModal, TaskComments
│   │   │   ├── timeline/  # ProjectTimeline
│   │   │   └── ui/        # Skeleton, EmptyState
│   │   ├── hooks/     # TanStack Query hooks (10 modules)
│   │   ├── pages/     # Page components by role
│   │   ├── stores/    # Zustand (auth + UI state)
│   │   └── lib/       # Constants, formatters, utilities
│   └── vite.config.ts
│
└── shared/            # TypeScript types, enums, constants
```

---

## Features by Role

### Super Admin / Admin
| Feature | Route | Description |
|---------|-------|-------------|
| Command Center Dashboard | `/dashboard` | Blockers, EOD status, project health, at-risk projects |
| Projects | `/projects` | CRUD with category/phase/health filters |
| Project Detail | `/projects/:id` | 5 tabs: Board, Sprints, Timeline, Decisions, Analytics |
| Standup View | `/standup` | Daily team updates — replaces standup meetings |
| Activity Feed | `/activity` | Real-time team activity stream |
| Analytics | `/analytics` | Velocity charts, health distribution, team utilization, blockers |
| Timesheet Approvals | `/approvals` | Review and approve/reject engineer timesheets |
| Resource Allocation | `/team` | Capacity planning — who's working on what |
| User Management | `/users` | Onboard/deboard users, edit roles |
| RBAC | `/rbac` | 28-permission matrix across 5 roles |

### Product Manager
| Feature | Route | Description |
|---------|-------|-------------|
| PM Dashboard | `/pm/dashboard` | Project overview with progress |
| Project Detail | `/pm/projects/:id` | Board, sprints, timeline, decisions |

### Engineer
| Feature | Route | Description |
|---------|-------|-------------|
| Split-View Dashboard | `/eng/dashboard` | Drag tasks Active → Done, productivity stats |
| My Tasks | `/eng/my-tasks` | All assigned tasks across projects |
| Timesheet | `/eng/timesheet` | Weekly hour grid with submit/approve workflow |
| EOD Update | `/eng/eod-update` | 3-step daily progress submission |
| Project Board | `/eng/projects/:id` | Kanban with drag-and-drop |

### Client
| Feature | Route | Description |
|---------|-------|-------------|
| Client Dashboard | `/client/dashboard` | Project health overview |
| Project Status | `/client/projects/:id` | Client-visible tasks, milestones, status updates |

---

## Core Features

### Project Management
- **8 project categories:** Flagship, Platform, B2C/SMB, Passion, Consulting, Social Impact
- **6 project phases:** Idea → Architecture → Development → Testing → Live → Maintenance
- **Health status:** Green / Yellow / Red with auto-health tracking
- **Project members** with role-based access

### Task Management
- **Human-readable IDs:** BPS-42, FXA-17 (project slug + auto-increment)
- **4 task types:** Feature, Bug, Chore, Spike (color-coded)
- **4 priority levels:** P0 Critical, P1 High, P2 Medium, P3 Low
- **5-column Kanban:** Backlog → To Do → In Progress → In Review → Done
- **Drag-and-drop** board powered by @dnd-kit
- **Story points:** Fibonacci-like (1, 2, 3, 5, 8, 13)
- **Subtasks** with progress tracking
- **Blocked status** with blocker notes
- **Labels** and **client visibility** flags
- **Comments** with @mentions and notifications

### Unified Task Card
One component renders tasks consistently everywhere:
- **Kanban variant:** Full card with all badges
- **List variant:** Compact row for tables/lists
- **Compact variant:** Minimal one-line display
- Shows: Task ID, title, priority, type, points, epic, sprint, assignee, subtask progress

---

## Sprint & Agile System

### Sprint Lifecycle
1. **Create Sprint** — name, goal, start/end dates (auto-increment number)
2. **Planning** — assign tasks from backlog to sprint
3. **Start Sprint** — only one active sprint per project
4. **Active** — team works on sprint tasks
5. **Complete Sprint** — auto-calculates retro stats, moves incomplete to backlog

### Epics
- Group related tasks across sprints
- Color-coded badges on task cards
- Progress tracking (tasks done / total, points done / total)

### Backlog
- Tasks not assigned to any sprint
- Visible in Sprint Board tab
- Drag tasks from backlog into sprint planning

### Sprint Retrospective
- Auto-generated stats on completion:
  - Total tasks, completed, carried over
  - Total points, completed points
- Manual sections: What went well, What didn't, Action items

---

## Daily Productivity

### EOD Update Flow
3-step guided process:
1. **Select tasks** you worked on + update their status
2. **Write summary**, blockers, tomorrow's plan + select mood
3. **Review & submit** → celebration screen with streak

### Streak Tracking
- Consecutive days of EOD submission
- Displayed as fire badge on engineer dashboard
- Motivational messages based on performance trend

### Engineer Dashboard (Obsidian-inspired)
- **Split-view:** Active tasks (left) ↔ Completed (right)
- **Drag to complete:** Move task from Active to Done zone
- **Compact stats:** Tasks this week, velocity, daily sparkline
- Clean, distraction-free design

### Timesheet
- **Weekly grid:** Mon-Sun × Projects
- **Submit for approval:** Engineer submits → PM reviews
- **Approval workflow:** Draft → Submitted → Approved/Rejected
- **Floating action bar:** Context-aware (Save/Submit/Reopen)
- Locked when submitted or approved

---

## Analytics & Reporting

### Portfolio Analytics (`/analytics`)
- **Velocity chart:** Stacked bar (tasks per project per week, 8 weeks)
- **Health pie chart:** Interactive donut (Healthy/At Risk/Critical)
- **Team utilization:** Per-person task bars with overloaded alerts
- **Blocker aging:** Days blocked with escalation coloring

### Project Analytics (project detail → Analytics tab)
- Task distribution by status (bar chart)
- Completion percentage with progress bar
- Overdue tasks alert

### Resource Allocation (`/team`)
- Per-person: active tasks, hours logged, capacity %
- Per-project breakdown chips
- Workload alerts: Available / Balanced / Overloaded
- Filter by project

### PM Dashboard (`/dashboard`)
- Active blockers with assignee and days blocked
- EOD status: who submitted / who hasn't (progress ring)
- Projects at risk with health badges
- Quick links to standup and approvals

---

## Communication

### @Mentions
- Type `@` in any comment to trigger member dropdown
- Select member → inserts `@Name` with indigo highlight
- Mentioned users receive a notification

### Notifications
- **Bell icon** in TopBar with unread count badge
- **Triggers:** Task assigned, blocker alert, @mention
- Click notification → navigates to relevant page
- Mark as read / mark all as read
- 15-second polling for updates

### Activity Feed (`/activity`)
- Real-time stream of all team actions
- Filter by project
- Auto-refresh every 30 seconds
- Action types: created, moved, blocked, unblocked, etc.

### Team Standup (`/standup`)
- **Replaces daily standup meetings**
- Date navigation (view any day)
- Per-person cards: summary, tasks, blockers, mood, tomorrow's plan
- Summary stats: updates count, tasks worked on, blockers reported

---

## Security

### Authentication
- JWT access tokens (15m expiry) + refresh tokens (7d, httpOnly cookie)
- bcrypt password hashing (12 salt rounds)
- Rate limiting: 5 login attempts / 15min (production)

### Authorization (RBAC)
- 5 roles: Super Admin, Admin, Product Manager, Engineer, Client
- 28+ granular permissions
- `<Can permission="...">` component for UI gating
- `authorize('permission.key')` middleware for API gating
- Permission matrix configurable via RBAC page

### Security Hardening
- **HSTS:** 1-year max-age with preload
- **CSP:** Script/style self-only in production
- **Referrer Policy:** strict-origin-when-cross-origin
- **Frame Guard:** DENY
- **Error sanitization:** No Prisma/Zod internals in production errors
- **Correlation IDs:** Every error has a unique errorId for debugging
- **Permission cache TTL:** 5 minutes (not infinite)
- **Password policy:** 10+ chars, uppercase, lowercase, number, special char
- **Rate limiting:** Refresh endpoint (30/15min), API (100/min)
- **Input validation:** Zod schemas on all endpoints
- **Transaction safety:** Atomic writes with prisma.$transaction

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Login with email/password |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Get current user + permissions |
| PUT | `/api/v1/auth/change-password` | Change password |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects` | List projects |
| POST | `/api/v1/projects` | Create project |
| GET | `/api/v1/projects/:id` | Get project detail |
| PUT | `/api/v1/projects/:id` | Update project |
| DELETE | `/api/v1/projects/:id` | Delete project |
| GET | `/api/v1/projects/:id/members` | List members |
| POST | `/api/v1/projects/:id/members` | Add member |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects/:id/tasks` | List tasks |
| POST | `/api/v1/projects/:id/tasks` | Create task (auto-generates ID) |
| GET | `/api/v1/tasks/:id` | Get task detail |
| PUT | `/api/v1/tasks/:id` | Update task |
| DELETE | `/api/v1/tasks/:id` | Delete task |
| PATCH | `/api/v1/tasks/:id/status` | Move task status |
| GET | `/api/v1/my-tasks` | Get my assigned tasks |

### Sprints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects/:id/sprints` | List sprints |
| POST | `/api/v1/projects/:id/sprints` | Create sprint |
| GET | `/api/v1/sprints/:id` | Sprint detail |
| PUT | `/api/v1/sprints/:id` | Update sprint |
| POST | `/api/v1/projects/:id/sprints/:id/start` | Start sprint |
| POST | `/api/v1/sprints/:id/complete` | Complete sprint |
| GET | `/api/v1/projects/:id/backlog` | Get backlog |
| PATCH | `/api/v1/tasks/:id/sprint` | Assign task to sprint |

### Epics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects/:id/epics` | List epics |
| POST | `/api/v1/projects/:id/epics` | Create epic |
| PUT | `/api/v1/epics/:id` | Update epic |
| DELETE | `/api/v1/epics/:id` | Delete epic |

### Daily Updates
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/daily-updates` | Submit EOD update |
| GET | `/api/v1/daily-updates/mine` | My update history |
| GET | `/api/v1/daily-updates/mine/streak` | My streak count |
| GET | `/api/v1/daily-updates/mine/stats` | My productivity stats |
| GET | `/api/v1/daily-updates/mine/today` | Today's submission status |
| GET | `/api/v1/daily-updates/team` | Team updates (Admin/PM) |

### Timesheet
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/timesheet/log` | Log time entry |
| POST | `/api/v1/timesheet/bulk` | Bulk log entries |
| GET | `/api/v1/timesheet/weekly` | Weekly timesheet |
| GET | `/api/v1/timesheet/status` | Submission status |
| POST | `/api/v1/timesheet/submit` | Submit for approval |
| GET | `/api/v1/timesheet/pending` | Pending approvals |
| PATCH | `/api/v1/timesheet/:id/approve` | Approve timesheet |
| PATCH | `/api/v1/timesheet/:id/reject` | Reject timesheet |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/analytics/portfolio` | Portfolio metrics |
| GET | `/api/v1/analytics/my-productivity` | Personal productivity |
| GET | `/api/v1/analytics/pm-dashboard` | PM dashboard data |
| GET | `/api/v1/analytics/team` | Team utilization |
| GET | `/api/v1/analytics/velocity` | Velocity data |
| GET | `/api/v1/analytics/blockers` | Blocker aging |
| GET | `/api/v1/analytics/resource-allocation` | Resource allocation |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/notifications` | List notifications |
| GET | `/api/v1/notifications/unread-count` | Unread count |
| PATCH | `/api/v1/notifications/:id/read` | Mark as read |
| PATCH | `/api/v1/notifications/read-all` | Mark all as read |

---

## Database Schema

### Core Models (12)
- **User** — auth, roles, profile
- **Project** — name, slug, category, phase, health, taskCounter
- **ProjectMember** — user-project relationship with role
- **Task** — taskNumber, title, type, status, priority, points, sprint, epic, assignee, subtasks
- **Sprint** — number, goal, dates, status, retroNotes
- **Epic** — title, description, color, status
- **Milestone** — date, status, client visibility
- **Decision** — ADR-style with rationale, alternatives
- **Comment** — on tasks/milestones/projects with @mention parsing
- **StatusUpdate** — health signals per project

### Productivity Models (4)
- **DailyUpdate** — EOD submission with mood, blockers, plans
- **DailyUpdateTask** — tasks touched in each EOD update
- **TaskStatusHistory** — every status transition tracked
- **TimeEntry** — hours per project per day

### System Models (4)
- **TimesheetWeek** — weekly submission status (Draft/Submitted/Approved/Rejected)
- **Notification** — in-app notifications with types and links
- **Permission** — RBAC permission definitions
- **RolePermission** — role-permission mappings
- **Activity** — audit trail for all actions

### Enums (12)
UserRole, ProjectCategory, ProjectPhase, HealthStatus, TaskStatus, TaskPriority, TaskType, MilestoneStatus, DecisionStatus, SprintStatus, EpicStatus, TimesheetStatus, Mood

---

## Setup & Deployment

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (Docker recommended)
- npm

### Quick Start
```bash
# 1. Start PostgreSQL
docker run -d --name exargen-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=exargen_cc \
  -p 5434:5432 \
  postgres:16

# 2. Install dependencies
npm install

# 3. Build shared package
npm run build:shared

# 4. Configure backend
cp backend/.env.example backend/.env
# Edit DATABASE_URL to point to your PostgreSQL

# 5. Run migrations
cd backend && npx prisma migrate deploy

# 6. Seed database
npx tsx src/seed/index.ts

# 7. Start development
cd .. && npm run dev:backend   # Terminal 1
npm run dev:frontend           # Terminal 2
```

### Demo Credentials

> ⚠️ **DEV / SEED ONLY.** These credentials populate the local seed only.
> They are documented in this file and therefore considered compromised.
> **Rotate the super-admin password before any real user logs in** —
> see [`docs/ADMIN_PLAYBOOK.md` §3d](docs/ADMIN_PLAYBOOK.md) and the
> `backend/scripts/reset-admin-password.ts` rotation utility.

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@exargen.in | Admin@1234 |
| Admin | anil@exargen.in | Admin@1234 |
| Product Manager | ravi@exargen.in | Admin@1234 |
| Engineer | karthik@exargen.in | Admin@1234 |
| Engineer | priya@exargen.in | Admin@1234 |
| Engineer | suresh@exargen.in | Admin@1234 |
| Client | pm@hpcl.co.in | Admin@1234 |

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open Command Palette |
| `Escape` | Close modals/palette |

---

## Commit History

| Commit | Description |
|--------|-------------|
| `cd18fda` | Sprint frontend — board UI, unified task card, task detail enhancements |
| `005e28a` | Sprint/Epic system — schema, backend APIs, human-readable task IDs |
| `f315eeb` | Dark mode + PM command center dashboard |
| `244ff4f` | V3 — Obsidian-inspired UI overhaul with split-view dashboard |
| `b8b3b95` | Use original Exargen logo (JPEG) |
| `80bf0a0` | V2 features — timesheet approval, resource allocation, @mentions |
| `5c017c5` | V1 Command Center — complete feature build with enterprise security |

---

## What's Next (V4 Roadmap)

### High Priority
- Move JWT from localStorage to httpOnly cookies (XSS mitigation)
- Token revocation on logout
- File attachments on tasks
- Global full-text search
- Mobile PWA support

### Medium Priority
- Task dependencies (blocked-by relationships)
- Custom fields on tasks
- Webhook/integration API (Slack, GitHub)
- Sprint velocity burndown charts
- Export reports (PDF/CSV)

### Future
- 2FA/MFA for admin accounts
- AI-powered weekly digest
- Onboarding wizard for new users
- Session management (logout specific devices)

---

*Built with enterprise-grade security, Obsidian-inspired design, and a focus on reducing meetings through async communication.*
