# HomeOS

A family household operating system for managing chores, responsibilities, rewards, penalties, task delegation, weekly balances, and Telegram reminders.

HomeOS was built as a practical family-management tool: instead of relying on verbal reminders and unclear responsibility, the app turns household routines into a transparent system with roles, deadlines, balances, appeals, and weekly accounting.

## Project Highlights

- Household task management with children/admin roles
- Daily kitchen duty rotation
- Waste and cleaning schedules
- Penalty and reward system with weekly balances
- Task marketplace for extra jobs and rescue tasks
- Gym reward tracking and admin confirmation
- Penalty cancellation requests and admin review
- Weekly ledger, payouts, and transaction audit
- Vacation mode to pause tasks and penalties
- Telegram reminders via Bot API
- Firebase Firestore realtime state synchronization
- Mobile-friendly PWA-style interface

## Core Idea

HomeOS treats a household like a small operating system:

```text
Routine tasks + deadlines + roles + money rules
  v
Clear responsibility and automatic accounting
  v
Less manual reminding, fewer arguments, more visible progress
```

The product is built around behavior design: chores are not just checkboxes, they affect balances, rewards, penalties, and weekly outcomes.

## Key Features

### Daily and Weekly Household Routines

- Kitchen duty rotation between family members
- Kitchen subtasks such as dishwasher, tables, and stove
- Waste reminders and completion tracking
- Monthly cleaning zones
- Overdue task handling and late penalties
- Vacation mode for pausing household obligations

### Rewards, Penalties, and Balances

HomeOS includes a small internal economy:

- Base weekly balance
- Penalties for late or unresolved tasks
- Rewards for extra jobs
- Gym rewards with admin confirmation
- Spending/expense entries
- Weekly expected payout calculation
- Total paid-out tracking

### Task Marketplace

The app includes a task marketplace where tasks can be created, assigned, reviewed, and resolved.

Use cases include:

- Parent-created tasks with rewards
- Rescue tasks when someone misses a duty
- Task claims and review states
- Photo proof for completion
- Failed-user restrictions for rescue jobs

### Bug and Issue Reporting

Household issues can be logged as "bugs" with photos, deadlines, status, and assignment logic.

This makes the app feel like a real operational tracker rather than a simple chore list.

### Admin Review and Appeals

- Children can request penalty cancellation
- Admin can approve or reject requests
- Admin can confirm gym reward requests
- Admin can adjust balances and delete ledger entries
- PIN-based local role switching for child/admin views

### Ledger and Audit Trail

The weekly ledger records events such as:

- Kitchen late penalties
- Waste late penalties
- Cleaning late penalties
- Bug fines
- Gym rewards
- Job rewards
- Job payments
- Expenses and manual adjustments

The ledger makes the system transparent and debuggable.

### Telegram Notifications

HomeOS can send Telegram reminders through the Telegram Bot API. This keeps important deadlines and events outside the app, where family members are more likely to see them.

## Tech Stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Styling and UI | Tailwind CSS, Motion, Lucide React |
| Backend | Express, esbuild, tsx |
| Data | Firebase Firestore |
| Media | Firebase Storage / image compression utilities |
| Notifications | Telegram Bot API |
| PWA | Web manifest, service worker, mobile app metadata |
| State | Custom React hook with Firestore transaction persistence |

## Architecture

```text
React / Vite App
  |
  |-- Dashboard
  |-- Task views
  |-- Task marketplace
  |-- Ledger
  |-- Settings and role switching
        |
        v
Custom App State Layer
  |
  |-- local optimistic updates
  |-- Firestore snapshot sync
  |-- Firestore transactions for writes
        |
        v
Firebase / Integrations
  |
  |-- Firestore: shared household state
  |-- Storage: task and issue photos
  |-- Telegram Bot API: reminders and notifications
```

## What I Built

- Designed a full household-management system with routines, roles, deadlines, rewards, and penalties
- Implemented a centralized `AppState` model for users, tasks, jobs, bugs, balances, payouts, and weekly logs
- Built a custom Firestore sync hook with optimistic local updates and transaction-based persistence
- Created admin and child views with PIN-based local role switching
- Implemented weekly ledger calculations and audit-style transaction history
- Added task marketplace logic with assignment, review, rewards, and rescue flows
- Added Telegram notification support through the Bot API
- Added image compression for task and issue photos to keep state manageable
- Built a mobile-friendly interface designed for daily repeated use

## Why This Project Matters

HomeOS demonstrates the ability to model complex real-life rules in software. The difficult part is not a single UI screen: it is the interaction between tasks, deadlines, roles, balances, appeals, rewards, and persistent shared state.

For recruiters, this project shows experience with:

- Building a real-world operational tool from scratch
- Modeling business rules and state transitions
- Designing role-based product flows
- Handling shared realtime state with Firestore
- Implementing optimistic updates and transaction-safe persistence
- Building audit trails and balance calculations
- Integrating external notification channels
- Designing a product for repeated daily use

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore configured
- Optional Telegram bot token and chat ID for reminders

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` or `.env.local` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

Depending on deployment setup, the app also checks `VITE_TELEGRAM_BOT_TOKEN` and `VITE_TELEGRAM_CHAT_ID`.

Firebase configuration is loaded from the project Firebase config file.

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Start Production Build

```bash
npm start
```

### Type Check

```bash
npm run lint
```

## Data Model Overview

HomeOS works with a centralized app state that includes:

- `users` - family members, balances, gym wallets, and earnings
- `kitchenDuty` and `kitchenTasks` - current kitchen owner and subtask states
- `wastes` and `cleaningTasks` - household recurring obligations
- `bugs` - issue reports with photos, deadlines, status, fines, and resolution photos
- `jobs` - task marketplace items with rewards, assignees, status, and linked duties
- `weeklyLog` - transaction-style audit entries
- `payouts` - weekly payout history
- `adminRequests` - penalty cancellation requests and decisions
- `vacationMode` - pause mode for household obligations

## Privacy and Safety Notes

This project contains family-specific workflow assumptions and sample users. A production version should include stronger authentication, user management, Firestore security rules, and private handling of household photos and financial records.

## Roadmap

- Replace PIN-based local role switching with full authenticated user accounts
- Add richer Firestore security rules for per-role access
- Add scheduled server-side reminders and overdue checks
- Add tests for balance calculations and task state transitions
- Add screenshots and a short walkthrough
- Add configurable household members, task types, rewards, and penalty rules
- Add deployment documentation

## License

Source files include an Apache-2.0 SPDX header.