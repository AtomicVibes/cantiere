# Geometra — Cantiere Management

> **Geometra** (Italian for "surveyor") is a full-featured, multi-tenant **construction and property management SaaS application**. It provides construction firms, architects, engineers, and property managers with a unified dashboard to manage projects, teams, clients, documents, finances, invoices, calendars, notifications, and real-time messaging.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Directory Structure](#directory-structure)
- [Features](#features)
- [Database & Migrations](#database--migrations)
- [Supabase Edge Functions](#supabase-edge-functions)
- [Authentication & Authorization](#authentication--authorization)
- [Push Notifications](#push-notifications)
- [Internationalization (i18n)](#internationalization-i18n)
- [Theming](#theming)
- [Deployment & CI/CD](#deployment--cicd)
- [Scripts](#scripts)
- [Role & Permission System](#role--permission-system)
- [Key Integrations](#key-integrations)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18.2, React Router v6 |
| **Build** | Vite 6.1 |
| **UI** | shadcn/ui (Radix Primitives), Tailwind CSS 3.4, `clsx` + `tailwind-merge` |
| **Icons** | Lucide React |
| **State / Data Fetching** | TanStack React Query 5, React Context |
| **Forms** | React Hook Form + Zod |
| **Backend / Database** | Supabase (PostgreSQL 15, Auth, Storage, Realtime) |
| **Hosting / Edge** | Cloudflare Pages + Cloudflare Workers |
| **CI/CD** | GitHub Actions |
| **Maps** | React Leaflet |
| **Charts** | Recharts |
| **Payments** | Stripe |
| **Messaging** | Supabase Realtime, wavesurfer.js (audio) |
| **Push Notifications** | Web Push API, VAPID, Service Worker |
| **i18n** | i18next + react-i18next (EN, AR, FR, IT, RTL) |
| **Animation** | Framer Motion 11 |
| **PDF** | jsPDF, html2canvas |
| **Linting** | ESLint 9 (flat config) |

---

## Architecture Overview

Geometra follows a **modern JAMstack / serverless architecture**:

1. **SPA Frontend** — React app built with Vite, deployed to Cloudflare Pages.
2. **Cloudflare Worker** (`_worker.js`) — Acts as a reverse-proxy edge handler: serves static assets from the Pages KV cache and provides an extensible `/api/` routing layer.
3. **Supabase** — PostgreSQL database with Row-Level Security (RLS), Supabase Auth (email/password + Google OAuth), Supabase Storage for file uploads, and Supabase Realtime for live messaging/notification updates.
4. **Supabase Edge Functions** (Deno) — Server-side logic for user/client invitation, project request review, user deletion, and push notification dispatching.
5. **base44 Platform** — Multi-tenant platform layer providing workspace/app context, parameter injection, and cross-app notifications.

The frontend communicates with Supabase directly via the Supabase JS client (for data reads and writes) and calls Edge Functions for operations that require elevated privileges or server-side processing.

---

## Directory Structure

```
cantiere/
├── .env.example                      # Environment variable template
├── .github/workflows/deploy.yml      # CI/CD pipeline
├── .wrangler/                        # Wrangler local state
│
├── public/                           # Static assets
│   ├── sw.js                         # Service Worker (push notifications)
│   ├── manifest.json                 # PWA manifest
│   ├── _redirects                    # Cloudflare Pages redirect rules
│   ├── favicon.svg
│   └── logo_*.svg / icon-*.png
│
├── src/
│   ├── main.jsx                      # App bootstrap
│   ├── App.jsx                       # Root component (routes, providers)
│   ├── index.css                     # Global CSS (Tailwind, theme vars, RTL)
│   ├── worker.js                     # Cloudflare Worker edge handler
│   │
│   ├── api/
│   │   ├── Client.js                 # base44 platform API client
│   │   └── base44Client.js           # Re-exports
│   │
│   ├── components/
│   │   ├── ui/                       # ~48 shadcn/ui primitives (button, dialog, etc.)
│   │   ├── layout/                   # AppLayout, Sidebar, TopBar, MobileNav
│   │   ├── dashboard/                # StatCard, RevenueChart, ProjectsByStatus, etc.
│   │   ├── projects/                 # ProjectCard, ProjectFormDialog, etc.
│   │   ├── teams/                    # TeamMemberCard, MessagePopover, AudioMessagePlayer
│   │   ├── shared/                   # EmptyState, StatusBadge, PriorityBadge
│   │   ├── ProtectedRoute.jsx        # Auth gate
│   │   ├── PermissionGate.jsx        # RBAC gate
│   │   ├── NotificationBell.jsx      # Push notification indicator
│   │   ├── RoleSelector.jsx
│   │   ├── Logo.jsx
│   │   └── AuthLayout.jsx
│   │
│   ├── config/
│   │   └── roles.js                  # Role initialization from DB
│   │
│   ├── constants/
│   │   └── index.js                  # Invoice statuses, job titles, doc types, etc.
│   │
│   ├── hooks/
│   │   ├── useSupabaseAuth.js
│   │   ├── useUserRole.js
│   │   ├── usePushNotification.js    # Push subscription lifecycle
│   │   ├── useDashboardData.js
│   │   ├── useTeamMembers.js
│   │   ├── useManagers.js
│   │   ├── use-mobile.jsx
│   │   ├── useFormSchema.js
│   │   └── useTranslatedConstants.js
│   │
│   ├── i18n/
│   │   ├── i18n.js                   # i18next config + all translations
│   │   └── LanguageProvider.jsx      # Language context with RTL/LTR direction
│   │
│   ├── lib/
│   │   ├── utils.js                  # cn() utility, isIframe helper
│   │   ├── AuthContext.jsx           # Auth provider (session, user, role)
│   │   ├── NotificationProvider.jsx  # Real-time notification state
│   │   ├── permissions.js            # RBAC permission matrix
│   │   ├── rbac.js                   # Permission denial helpers
│   │   ├── validation.js             # Zod schemas
│   │   ├── app-params.js             # base44 platform params
│   │   ├── avatar.js                 # Initials extraction
│   │   ├── query-client.js           # TanStack Query client
│   │   ├── database.types.ts         # Supabase DB types
│   │   └── PageNotFound.jsx
│   │
│   ├── pages/                        # 20 route pages
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   ├── AuthCallback.jsx
│   │   ├── ForgotPassword.jsx
│   │   ├── ResetPassword.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Projects.jsx
│   │   ├── ProjectDetail.jsx
│   │   ├── ProjectRequests.jsx
│   │   ├── Teams.jsx
│   │   ├── Clients.jsx
│   │   ├── Finance.jsx
│   │   ├── Invoices.jsx
│   │   ├── Documents.jsx
│   │   ├── CalendarPage.jsx
│   │   ├── MessagesPage.jsx
│   │   ├── Notifications.jsx
│   │   ├── Settings.jsx
│   │   ├── Reports.jsx
│   │   ├── Logs.jsx
│   │   └── AdminInbox.jsx
│   │
│   ├── services/
│   │   ├── supabase.js               # Supabase client init
│   │   ├── authService.js            # Sign-in/out, password reset, OAuth
│   │   ├── dataService.js            # Generic CRUD wrapper
│   │   ├── projectService.js
│   │   ├── inviteService.js          # Invite users/clients via Edge Functions
│   │   ├── profileService.js         # Language preference
│   │   └── requestService.js         # Project request CRUD
│   │
│   ├── types/
│   │   └── declarations.d.ts
│   │
│   └── utils/
│       ├── index.ts
│       └── logger.js                 # Audit logging to DB
│
├── supabase/
│   ├── config.toml                   # Supabase local config
│   ├── functions/                    # 7 Edge Functions (Deno/TS)
│   └── migrations/                   # 15 SQL migrations
│
├── scripts/
│   └── validate-vapid-key.mjs        # VAPID key validator/generator
│
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.js
├── jsconfig.json
├── components.json                   # shadcn/ui config
└── wrangler.jsonc                    # Cloudflare Pages config
```

---

## Features

### Authentication & Authorization
- Email/password registration and login
- Google OAuth single sign-on
- Password reset flow (forgot/reset password)
- Role-based access control with four roles: `super_admin`, `admin`, `manager`, `client`
- Fine-grained permission matrix scoped per module (projects, teams, clients, finance, documents, settings)
- `ProtectedRoute` component guards page access; `PermissionGate` component conditionally renders UI elements
- Row-Level Security (RLS) enforced at the database level

### Project Management
- Full CRUD for construction and property projects
- Multiple project types: Construction, Renovation, Apartment Sale, Property Rental, Property Management, Consulting
- Status workflow: Draft → Planning → In Progress → On Hold → Completed
- Priority levels: Low, Medium, High, Critical
- Project timelines with milestone tracking
- Document attachment per project
- Manager and team member assignments
- Client project request submission workflow (submit → verify → approve/reject)

### Team Management
- Invite team members via email or direct creation
- Job titles: Architect, Civil Engineer, Interior Designer, Supervisor, Contractor, Quantity Surveyor, etc.
- Department tracking
- Member statuses: Active, Inactive, On Leave
- Profile management with language preferences

### Client Management
- Client profiles with company details and contact information
- Client portal for project request submission
- Request lifecycle with admin review and approval/rejection

### Finance & Invoicing
- Invoice management with full CRUD
- Invoice statuses: Draft, Pending, Paid, Partially Paid, Overdue, Cancelled
- Categories: Materials, Labor, Equipment, Architecture, Engineering, Consulting, Permits
- Revenue dashboard with historical charts (Recharts)
- Budget tracking vs actual costs
- Stripe payment integration

### Real-Time Messaging
- Split-pane inbox with conversation list and message thread
- Real-time message delivery via Supabase Realtime
- Read receipts with per-user tracking
- Voice message recording and playback with waveform visualization (wavesurfer.js)
- Admin inbox for client communication
- Message deletion support
- Mobile-responsive full-screen chat overlay with animated transitions

### Push Notifications
- Web Push API with VAPID authentication
- Service Worker for push event handling and notification display
- `notificationclick` navigation to relevant app pages
- Subscription management via `push_subscriptions` table with upsert
- Global concurrency lock to prevent race conditions during registration
- Silent subscription (no verbose logging in production)
- Real-time notification badge count via Supabase Realtime subscriptions
- Mark-as-read and mark-all-as-read with optimistic UI rollback

### Documents
- Centralized document repository
- Categorization: Blueprints, Contracts, Permits, Photos, CAD Files, Reports
- File upload to Supabase Storage
- Per-project document filtering

### Calendar
- Event creation and management
- Date picker for event scheduling

### Reports & Analytics
- Dashboard with stat cards (total projects, active projects, revenue, team members)
- Revenue chart with historical data
- Projects grouped by status visualization
- Upcoming deadlines view
- Budget vs actual cost comparison

### Audit Logging
- Tracks project creation, updates, and deletion
- Logs member additions and removals
- Records invoice creation and status changes
- Captures timeline changes
- Logs written to a dedicated `audit_logs` database table

### Internationalization (i18n)
- 4 languages: English, Arabic, French, Italian
- Full Arabic RTL support with CSS logical properties
- RTL-aware icon flipping, text alignment, and layout mirroring
- Language auto-detection from browser preferences
- Language preference persisted to user profile

### Theming
- Light and dark modes with system preference detection
- CSS custom properties for full theme customization
- Manual theme toggle in settings

### PWA Features
- `manifest.json` with standalone display, themed status bar, and app icons
- `apple-mobile-web-app-capable` meta tags for iOS
- Service Worker for push notifications

---

## Database & Migrations

The database is **PostgreSQL 15** hosted on Supabase. There are **15 SQL migrations** in `supabase/migrations/`:

| # | Migration | Purpose |
|---|---|---|
| 1 | `handle_new_user` | Trigger + function to auto-create profile on signup |
| 2 | `add_profile_fields` | Extend profiles with name, role, language, avatar, etc. |
| 3 | `fix_rls_recursion` | Resolve infinite recursion in profile RLS policies |
| 4 | `project_requests` | Client project request submission table |
| 5 | `project_requests_extended` | Additional request metadata and workflow fields |
| 6 | `fix_clients_team_members` | Normalize client and team member relationships |
| 7 | `fix_rls_profiles_direct` | Direct profile access policies |
| 8 | `fix_clients_trigger_backfill` | Backfill client records for existing users |
| 9 | `create_project_timeline` | Project timeline/milestone tracking |
| 10 | `fix_timeline_rls_manager` | Timeline RLS policies for manager role |
| 11 | `create_audit_logs` | Activity audit log table |
| 12 | `audit_profile_role_changes` | Extend audit logging for role changes |
| 13 | `push_notifications` | Push subscription table |
| 14 | `mark_chat_as_read` | Read receipt tracking |
| 15 | `delete_messages` | Message deletion support |

Key database tables (inferred from migrations and services):
- `profiles` — User profiles with role, name, avatar, language
- `projects` — Construction/property projects
- `project_requests` — Client-initiated project requests
- `project_timeline` — Milestone/event tracking per project
- `team_members` — Team member records linked to profiles
- `clients` — Client records linked to profiles/companies
- `invoices` — Financial invoices with status and category
- `messages` — Real-time chat messages
- `conversation_participants` — Chat conversation membership
- `notifications` — In-app notifications
- `push_subscriptions` — Web Push subscription endpoints
- `audit_logs` — Activity history
- `roles` — Role definitions for RBAC

---

## Supabase Edge Functions

Seven Edge Functions in `supabase/functions/` (TypeScript, Deno runtime):

| Function | Purpose |
|---|---|
| `invite-user` | Invite a new user to the platform, create profile, send email |
| `invite-client` | Invite a client user, create client record |
| `create-client` | Create a client record for an existing user |
| `create-project-request` | Allow clients to submit a project request |
| `review-project-request` | Admin/manager approval or rejection of requests |
| `delete-user` | Admin user deletion with cleanup |
| `send-push` | Dispatch push notifications via `web-push` library |

---

## Authentication & Authorization

### Auth Flow
1. User signs in via Supabase Auth (email/password or Google OAuth).
2. `AuthContext` consumes the Supabase session and makes the user object available app-wide.
3. On first login, a database trigger (`handle_new_user`) auto-creates a profile row.
4. The user's role is fetched from `profiles` and cached in context.
5. Routes are guarded by `ProtectedRoute`; UI elements are conditionally rendered via `PermissionGate`.

### Role-Based Access Control (RBAC)
The RBAC system operates at two levels:

1. **Frontend permission matrix** (`src/lib/permissions.js`):
   - Defines allowed roles per action (e.g., `projects.create`, `invoices.delete`)
   - `PermissionGate` component wraps UI elements and checks the current user's role against the required permission
   - Denial helpers in `src/lib/rbac.js` provide standardized "access denied" UI

2. **Database Row-Level Security (RLS)**:
   - All tables have RLS policies scoped to roles
   - Multiple migrations were dedicated to fixing RLS recursion and ensuring correct policy enforcement
   - Policies reference `auth.uid()` and check the user's role from `profiles`

### Roles
| Role | Scope |
|---|---|
| `super_admin` | Full system access, all modules |
| `admin` | Management access (projects, teams, clients, finance, documents, settings) |
| `manager` | Operational access (assigned projects, team collaboration) |
| `client` | Limited access (own projects, requests, messaging with assigned admins) |

---

## Push Notifications

### Architecture
1. **Registration**: `usePushNotification` hook registers the Service Worker, requests `Notification.permission`, subscribes via `pushManager.subscribe()` with VAPID public key, and upserts the subscription to the `push_subscriptions` table.
2. **Storage**: Subscription objects (endpoint + keys) stored in the `push_subscriptions` table with a concurrency guard to prevent duplicate subscriptions.
3. **Dispatch**: The `send-push` Edge Function uses the `web-push` library to send notifications to subscribed endpoints.
4. **Receipt**: The Service Worker (`public/sw.js`) listens for `push` events and displays notifications. The `notificationclick` event navigates the user to the relevant page.
5. **UI**: `NotificationProvider` subscribes to a Supabase Realtime channel on `notifications` to show live unread counts. `NotificationBell` renders the badge. Mark-as-read operations use optimistic UI patterns.

### Files Involved
- `src/hooks/usePushNotification.js` — Subscription lifecycle
- `public/sw.js` — Service Worker
- `src/components/NotificationBell.jsx` — UI bell with count
- `src/lib/NotificationProvider.jsx` — Realtime state
- `supabase/functions/send-push/index.ts` — Edge Function
- `scripts/validate-vapid-key.mjs` — Key validation

---

## Internationalization (i18n)

- **Framework**: i18next + react-i18next
- **Languages**: English (`en`), Arabic (`ar`), French (`fr`), Italian (`it`)
- **RTL Support**: Arabic uses RTL layout. The `LanguageProvider` sets the `dir` attribute on `<html>` and applies RTL-aware CSS via logical properties (`inset-inline-start`, `margin-inline-end`, `transform: scaleX(-1)` for icons, etc.)
- **Translation Keys**: Scoped by module (`common`, `auth`, `projects`, `teams`, `finance`, `messages`, etc.)
- **Auto-Detection**: Language auto-detected from browser preferences, overridable in user settings and persisted to the `profiles` table

---

## Theming

- **Implementation**: CSS custom properties defined in `index.css` under `.light` and `.dark` selectors
- **Toggle**: Uses `next-themes` (`ThemeProvider`) with system preference detection
- **Colors**: Full palette defined as CSS variables (background, foreground, card, muted, primary, secondary, destructive, accent, border, ring)
- **Components**: All shadcn/ui components consume these variables, making them fully theme-aware

---

## Deployment & CI/CD

### Hosting
- **Cloudflare Pages** serves the built SPA from `dist/`
- **Cloudflare Worker** (`src/worker.js`) intercepts all requests:
  - Serves static assets directly from Pages KV
  - Falls back to `index.html` for SPA client-side routing
  - Provides an `/api/*` routing stub for future API endpoints
- Custom `_redirects` file disables Cloudflare's automatic SPA rewrite to keep the Worker in control

### Build Pipeline
```bash
npm run prebuild     # Extract env vars from wrangler.jsonc → .env
npm run build        # vite build + copy worker.js → dist/_worker.js
npm run deploy       # Build + deploy to Cloudflare Pages (production branch)
npm run deploy:preview  # Build + deploy to preview branch
```

### CI/CD (GitHub Actions)
- File: `.github/workflows/deploy.yml`
- Triggers: push to `main`, pull requests targeting `main`
- Steps:
  1. Checkout repository
  2. Set up Node.js
  3. Install dependencies
  4. Build (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` injected from secrets)
  5. Deploy via `cloudflare/wrangler-action@v3`

### Environment Variables
Key variables configured in `wrangler.jsonc` and `.env.example`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous API key
- `VITE_VAPID_PUBLIC_KEY` — VAPID public key for push notifications
- `VITE_BASE44_APP_ID` — base44 platform application ID

---

## Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `vite` | Start development server |
| `build` | `vite build && copy-cli` | Build for production + copy worker |
| `preview` | `vite preview` | Preview production build locally |
| `prebuild` | `node scripts/extract-env.mjs` | Extract env vars from wrangler.jsonc |
| `deploy` | `npm run build && wrangler pages deploy --branch production` | Build + deploy to production |
| `deploy:preview` | `npm run build && wrangler pages deploy` | Build + deploy to preview |
| `lint` | `eslint .` | Lint all files |

---

## Role & Permission System

### Permission Matrix (`src/lib/permissions.js`)
Permissions are organized by module and action:

| Module | Actions | Allowed Roles |
|---|---|---|
| `projects` | create, edit, delete, view, assign | super_admin, admin, manager |
| `teams` | create, edit, delete, view, invite | super_admin, admin |
| `clients` | create, edit, delete, view | super_admin, admin |
| `finance` | create_invoices, edit_invoices, delete_invoices, view_finances | super_admin, admin |
| `documents` | upload, delete, view | super_admin, admin, manager |
| `settings` | manage_roles, manage_system | super_admin |
| `messages` | send, delete_any | super_admin, admin |

### Usage in Components
```jsx
<PermissionGate permission="projects.create">
  <Button>New Project</Button>
</PermissionGate>
```

Denied users see nothing (or an alternative UI via the `fallback` prop).

---

## Key Integrations

| Integration | Purpose | Files |
|---|---|---|
| **Supabase** | Database, Auth, Storage, Realtime, Edge Functions | `src/services/supabase.js`, all services |
| **Cloudflare Pages** | Hosting + Edge Worker | `src/worker.js`, `wrangler.jsonc` |
| **Stripe** | Payment processing | `@stripe/react-stripe-js`, `@stripe/stripe-js` |
| **Leaflet** | Interactive maps | `react-leaflet` |
| **base44** | Multi-tenant platform layer | `src/api/Client.js`, `src/lib/app-params.js` |
| **Google OAuth** | Social login | `authService.js` |
| **Web Push API** | Browser push notifications | `public/sw.js`, `usePushNotification.js` |
| **wavesurfer.js** | Audio waveform visualization | `AudioMessagePlayer.jsx` |
| **React Quill** | Rich text editing | `react-quill` |
| **Framer Motion** | Page transitions, animations | `framer-motion` |

---

## Development Notes

### Code Conventions
- **JavaScript** (primary) with gradual TypeScript adoption via JSDoc (`jsconfig.json` with `checkJs: true`)
- React functional components with hooks (no class components)
- Custom hooks for business logic; services layer for API calls
- Component library uses shadcn/ui conventions (Radix primitives, `cn()` utility)
- ESLint flat config with React, React Hooks, and unused-imports plugins

### State Management
- **Server state**: TanStack React Query (caching, invalidation, optimistic updates)
- **Client state**: React Context (auth, notifications, language)
- **Form state**: React Hook Form + Zod validation schemas

### Real-Time Subscriptions
- Notifications channel: `notifications` table changes
- Messages channel: `messages` table changes per conversation
- Managed via Supabase JS client's `.channel()` API

### Build Output
The production build produces a `dist/` directory containing:
- Static assets (JS, CSS, fonts, images)
- `_worker.js` (the Cloudflare Worker) copied from `src/worker.js`
- `_redirects` for edge redirect rules
- `sw.js` service worker from `public/`

---

## Licensing & Status

- **Version**: 0.0.0 (pre-release / active development)
- **Author**: AtomicVibes
- **Platform**: Built on the base44 multi-tenant platform
- **Status**: Active development with recent focus on push notifications, real-time messaging, and RBAC security hardening
