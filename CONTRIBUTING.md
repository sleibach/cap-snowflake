# Contributing to cap-snowflake

Thank you for your interest in contributing to cap-snowflake! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful and constructive in all interactions. We aim to foster an inclusive and welcoming community.

## How to Contribute

### Reporting Bugs

If you find a bug:

1. Check if it's already reported in [GitHub Issues](https://github.com/your-repo/cap-snowflake/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node.js version, CAP version, etc.)
   - Code samples or error messages

### Suggesting Features

Feature requests are welcome! Please:

1. Check existing issues and discussions
2. Create a new issue with:
   - Clear use case description
   - Expected behavior
   - Alternative solutions you've considered
   - Willingness to implement (if applicable)

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `develop`:
   ```bash
   git checkout -b feature/my-feature develop
   ```
3. **Make your changes**:
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed
4. **Run tests**:
   ```bash
   npm run lint
   npm run build
   npm test
   ```
5. **Commit** with clear messages:
   ```bash
   git commit -m "feat: add support for X"
   ```
   Follow [Conventional Commits](https://www.conventionalcommits.org/)
6. **Push** to your fork:
   ```bash
   git push origin feature/my-feature
   ```
7. **Open a Pull Request** to `develop` branch

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/cap-snowflake.git
cd cap-snowflake

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (for development)
npm run watch
```

### Testing

- **Unit tests** should cover all new logic
- **Integration tests** for Snowflake connectivity (optional but encouraged)
- Maintain test coverage above 80%

```bash
# Unit tests only
npm run test:unit

# Integration tests (requires Snowflake account)
export SNOWFLAKE_TEST=true
export SNOWFLAKE_ACCOUNT=...
npm run test:integ
```

### Code Style

- TypeScript with strict mode
- ESLint configuration provided
- Use descriptive variable names
- Add JSDoc comments for public APIs
- Keep functions focused and small

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for TIME_TRAVEL queries
fix: handle null values in VARIANT columns
docs: update README with JWT setup instructions
test: add tests for complex $filter expressions
```

### Documentation

- Update README.md for user-facing changes
- Update inline comments for code changes
- Add/update examples if applicable
- Update CHANGELOG.md

### Areas for Contribution

Great places to start:

- **DDL Generation**: Implement full `cds deploy` support
- **Query Optimization**: Improve $expand with JOINs
- **Testing**: Add more test cases and scenarios
- **Documentation**: Improve examples and troubleshooting
- **Performance**: Connection pooling, query caching
- **Features**: Time travel, clustering hints, etc.

## Questions?

- Open a [Discussion](https://github.com/your-repo/cap-snowflake/discussions)
- Ask in issues with the `question` label

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

