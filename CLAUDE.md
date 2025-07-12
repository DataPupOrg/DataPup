# AI Agent Context for Data-Pup

## Project Overview
Data-Pup is a modern, AI-assisted, cross-platform database client built with Electron, React, and TypeScript. It provides a user-friendly interface for connecting to and querying various databases.

## Technology Stack
- **Frontend**: React 19 with TypeScript
- **Desktop Framework**: Electron
- **Build Tool**: Vite
- **UI Components**: Radix UI with custom theme system
- **Styling**: CSS with CSS Variables for theming
- **Code Quality**: ESLint v9 (flat config), Prettier, EditorConfig
- **Layout**: react-resizable-panels for split panes

## Architecture Decisions

### IPC Communication
We use Electron IPC (Inter-Process Communication) instead of an HTTP server for:
- Better security (no exposed ports)
- Better performance (direct process communication)
- Simpler architecture

### Component Structure
```
src/
├── main/           # Electron main process
│   └── index.ts    # IPC handlers for database operations
└── renderer/       # React application
    ├── components/
    │   ├── ui/     # Reusable UI components (Button, Card, Dialog, etc.)
    │   ├── ActiveConnectionLayout/  # Layout for active DB connections
    │   ├── DatabaseConnection/      # Connection dialog/form
    │   ├── DatabaseExplorer/        # Database tree view
    │   ├── Layout/                  # Layout components
    │   ├── QueryEditor/             # SQL editor component
    │   ├── QueryResults/            # Results grid
    │   └── ThemeSwitcher/           # Theme selection dropdown
    └── lib/
        └── theme/  # Theme system with 8 pre-built themes
```

## Key Features

### Theme System
- 8 pre-built themes stored in localStorage
- Themes: light, dark, ocean, sunset, forest, lavender, rose, amber
- Applied via CSS variables on document root

### Database Support
Currently supports:
- ClickHouse (default)
- PostgreSQL (planned)
- MySQL (planned)
- SQLite (planned)

### UI States
1. **No Connection**: Shows MainPanel with connection options and saved connections
2. **Active Connection**: Shows ActiveConnectionLayout with:
   - DatabaseExplorer (left panel, resizable)
   - QueryWorkspace (right panel) containing QueryEditor and QueryResults

## Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing patterns in the codebase
- NO COMMENTS unless explicitly requested
- Use existing UI components from `src/renderer/components/ui/`
- Follow Radix UI patterns for new components

## AI Assistant Guidelines
- Always use descriptive memory Names

### Git Workflow
- Feature branches from main
- Meaningful commit messages
- NO Claude attribution in commits (user preference)

### Testing & Validation
Before committing:
```bash
npm run lint
npm run format:check
npm run typecheck  # if available
```

### Common Tasks

#### Adding a new database type
1. Update `getSupportedTypes` in main process
2. Add connection logic in `ipcMain.handle('db:connect')`
3. Update DatabaseConnection component to handle new type
4. Add appropriate default port in `getDefaultPort()`

#### Creating new UI components
1. Check existing components in `src/renderer/components/ui/`
2. Use Radix UI primitives when possible
3. Follow the established pattern (see Button.tsx or Card.tsx)
4. Support all 8 themes via CSS variables

#### Working with themes
- Theme colors are defined in `src/renderer/lib/theme/themes.ts`
- Always use CSS variables (e.g., `var(--color-primary)`)
- Test components in multiple themes

## Current State & Known Issues

### Recent Changes
- Merged MainPanel from main branch for connection selection view
- ActiveConnectionLayout implemented with resizable panels
- Theme system fully functional with dropdown switcher

### Pending Work
- Implement actual database connection logic
- Add database-specific drivers (pg, mysql2, etc.)
- Implement tree view in DatabaseExplorer
- Add query execution in QueryEditor
- Implement results display in QueryResults

## Important Notes
- Always ensure components take full window width (no Container size restrictions)
- Use Box instead of Container for full-width layouts
- Maintain responsive design for different window sizes
- Follow POSIX compliance (add trailing newlines to files)

## Environment Setup
```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build

# Linting and formatting
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Quick Command Reference
- Start dev server: `npm run dev`
- Create new branch: `git checkout -b feature/branch-name`
- Run linting: `npm run lint`
- Format code: `npm run format`
```