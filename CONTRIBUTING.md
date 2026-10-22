# Contributing to SkyGlass

Thank you for your interest in contributing to SkyGlass! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/SkyGlass.git
   cd SkyGlass
   ```
3. **Set up the development environment**:
   ```bash
   npm install                   # Node workspaces
   npm run setup:dev -- deps     # Python venv for packages/presence (compiles dlib)
   npm run dev:mirror            # backend :3001 + mirror UI :5173
   ```
   On a Raspberry Pi use `./scripts/setup-pi.sh` instead. See
   [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for the full local pipeline.

## Development Workflow

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. Make your changes

3. Run tests:
   ```bash
   npm test
   ```

4. Run linting:
   ```bash
   npm run lint
   npm run format
   ```

5. Commit your changes:
   ```bash
   git commit -m 'Add amazing feature'
   ```

6. Push to your fork:
   ```bash
   git push origin feature/amazing-feature
   ```

7. Open a Pull Request

## Code Style

### TypeScript (Backend/Frontend)

- Use TypeScript strict mode
- Follow the existing code style
- Run `npm run format` before committing
- Add JSDoc comments for public APIs

### Python (Presence Detection)

- Follow PEP 8 style guide
- Use type hints where appropriate
- Keep functions focused and small
- Add docstrings to functions

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add gesture recognition for display control

- Add GestureDetector class with swipe detection
- Integrate with presence detector
- Add configuration options for gesture sensitivity
```

Prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## Project Structure

```
SkyGlass/
├── packages/
│   ├── backend/        # Node.js API server (@skyglass/backend)
│   ├── frontend/       # React display UI (@skyglass/frontend)
│   ├── mobile/         # React Native/Expo phone app (setup + layout editor)
│   ├── presence/       # Python presence detection + admin server
│   ├── cloud-api/      # Optional cloud sync API (@skyglass/cloud-api)
│   └── website/        # Marketing site (Vercel)
├── config/           # default.yaml, PM2 config, systemd units
├── scripts/          # Setup and utility scripts
└── docs/             # Documentation
```

## Testing

### Running Tests

```bash
# All tests
npm test

# Backend only
npm test --workspace=packages/backend

# Watch mode
npm run test:watch

# Specific test file
npm test -- aviation
```

### Writing Tests

- Place tests next to the code: `file.ts` → `file.test.ts`
- Use descriptive test names
- Test both success and error cases
- Mock external APIs

Example:
```typescript
describe('AviationService', () => {
  describe('getMetar', () => {
    it('should return parsed METAR for valid ICAO', async () => {
      const metar = await getMetar('KJFK');
      expect(metar.icao).toBe('KJFK');
      expect(metar.flightRules).toBeDefined();
    });

    it('should throw for invalid ICAO', async () => {
      await expect(getMetar('XXXX')).rejects.toThrow();
    });
  });
});
```

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is formatted (`npm run format`)
- [ ] Documentation is updated (if applicable)
- [ ] Commit messages are clear

### PR Description

Include:
- What the change does
- Why it's needed
- How to test it
- Screenshots (for UI changes)

### Review Process

1. PRs require one approval before merging
2. Address review comments promptly
3. Keep PRs focused and reasonably sized
4. Squash commits when merging

## Adding a New Widget

1. Create the widget component and its styles (wrap it in `ModuleFrame` for the shared chrome):
   ```
   packages/frontend/src/components/modules/MyWidgetModule.tsx
   packages/frontend/src/components/modules/MyWidgetModule.css
   ```

2. Register its id in `packages/frontend/src/components/modules/index.ts`

3. Add the same id (sizes, settings) to the widget catalog in `packages/mobile/lib/modules.ts`;
   the phone's layout editor configures it from there

4. Add backend service if needed:
   ```
   packages/backend/src/services/myservice.ts
   packages/backend/src/routes/myservice.ts
   ```

5. Add tests for the service

6. Update documentation (data endpoints go in `docs/WIDGETS.md`)

## Adding a New Backend Service

1. Create the service:
   ```typescript
   // packages/backend/src/services/myservice.ts
   export async function getData(): Promise<MyData> {
     // Implementation
   }
   ```

2. Create the route:
   ```typescript
   // packages/backend/src/routes/myservice.ts
   router.get('/', async (req, res) => {
     const data = await getData();
     res.json(data);
   });
   ```

3. Mount it in `server.ts`: `app.use('/api/myservice', myserviceRoutes);`

4. Add tests

## Reporting Issues

### Bug Reports

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, etc.)
- Logs or screenshots

### Feature Requests

Include:
- Clear description of the feature
- Use case / why it's needed
- Proposed implementation (if any)

## Questions?

- Open an issue for questions
- Check existing issues first
- Be patient and respectful

Thank you for contributing!
