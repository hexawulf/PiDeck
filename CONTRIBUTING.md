# Contributing to PiDeck

Thank you for your interest in contributing to PiDeck! This guide will help you get started with contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Bug Reports](#bug-reports)
- [Feature Requests](#feature-requests)

## Code of Conduct

This project adheres to a code of conduct that we expect all contributors to follow. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Git
- Basic knowledge of React, TypeScript, and Express.js

### Development Setup

1. **Fork the repository**
   ```bash
   # Click the "Fork" button on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/PiDeck.git
   cd PiDeck
   ```

2. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/hexawulf/PiDeck.git
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

## Contributing Guidelines

### Code Style

- **TypeScript**: Use TypeScript for all new code
- **Formatting**: Use Prettier for code formatting
- **Linting**: Follow ESLint rules
- **Naming**: Use descriptive variable and function names

### Git Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clean, documented code
   - Add tests for new functionality
   - Update documentation as needed

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "Add feature: brief description"
   ```

4. **Keep your branch updated**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Commit Message Format

Use clear and descriptive commit messages:

```
type(scope): brief description

Longer description if needed

- Detail 1
- Detail 2
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

## Pull Request Process

### Before Submitting

1. **Test your changes**
   ```bash
   npm run build
   npm run test
   ```

2. **Update documentation**
   - Update README.md if needed
   - Add/update JSDoc comments
   - Update CHANGELOG.md

3. **Check code quality**
   ```bash
   npm run lint
   npm run format
   ```

### PR Requirements

- Clear title and description
- Reference related issues
- Include screenshots for UI changes
- Add tests for new functionality
- Ensure all CI checks pass

### PR Template

When creating a PR, use this template:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Related Issues
Fixes #(issue number)

## Testing
- [ ] Tested locally
- [ ] Added unit tests
- [ ] Manual testing completed

## Screenshots (if applicable)
Add screenshots here

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
```

## Bug Reports

### Before Reporting
1. Check existing issues
2. Ensure you're using the latest version
3. Try to reproduce the issue

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g. Ubuntu 20.04]
- Node.js version: [e.g. 18.16.0]
- Browser: [e.g. Chrome 91]
- PiDeck version: [e.g. 1.0.0]

**Additional context**
Any other context about the problem.
```

## Feature Requests

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear description of what the problem is.

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives you've considered**
Other solutions you've considered.

**Additional context**
Add any other context or screenshots.
```

## Development Guidelines

### Architecture

- **Frontend**: React components in `client/src/components`
- **Backend**: Express routes in `server/routes.ts`
- **Shared**: Types and schemas in `shared/schema.ts`
- **Styling**: TailwindCSS with component variants

### Testing

- Write unit tests for new functions
- Add integration tests for API endpoints
- Test UI components with user interactions

### Performance

- Use React Query for API state management
- Implement proper loading states
- Optimize bundle size
- Cache expensive operations

### Security

- Validate all inputs
- Use parameterized queries
- Implement proper authentication
- Follow OWASP guidelines

## Areas for Contribution

### High Priority
- Mobile responsiveness improvements
- Additional system metrics
- Enhanced log parsing and filtering
- Performance optimizations

### Medium Priority
- Multi-user authentication
- Plugin system for custom integrations
- Advanced charting and visualization
- Configuration management UI

### Good First Issues
- UI/UX improvements
- Documentation updates
- Bug fixes
- Code refactoring

## Development Tips

### Debugging
```bash
# Backend debugging
DEBUG=express:* npm run dev

# View logs
tail -f /home/zk/logs/*.log
```

### Database Changes
```bash
# Generate migration
npm run db:generate

# Push changes
npm run db:push
```

### Testing
```bash
# Run all tests
npm test

# Run specific test
npm test -- --grep "test name"

# Watch mode
npm test -- --watch
```

## Recognition

Contributors will be recognized in:
- README.md contributors section
- CHANGELOG.md for significant contributions
- GitHub releases notes

## Questions?

- Open a [GitHub Discussion](https://github.com/hexawulf/PiDeck/discussions)
- Join our community chat (link coming soon)
- Email the maintainers

Thank you for contributing to PiDeck! 🎉