# Contributing to Data-Pup 🐶

First off, thank you for considering contributing to Data-Pup! It's people like you that make Data-Pup such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by the [Data-Pup Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots and animated GIFs** if possible
- **Include your environment details** (OS, Node version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain which behavior you expected to see instead**
- **Explain why this enhancement would be useful**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code follows the existing code style
6. Issue that pull request!

## Development Process

1. **Set up your development environment:**

   ```bash
   git clone https://github.com/YOUR_USERNAME/data-pup.git
   cd data-pup
   npm install
   npm run dev
   ```

2. **Make your changes:**
   - Write meaningful commit messages
   - Follow the existing code style
   - Add tests for new features
   - Update documentation as needed

3. **Test your changes:**

   ```bash
   npm run build
   npm run preview
   ```

4. **Submit your PR:**
   - Provide a clear description of the problem and solution
   - Include the relevant issue number if applicable
   - Screenshots/GIFs for UI changes are helpful

## Logging Usage

This project uses [electron-log](https://github.com/megahertz/electron-log) for logging purposes.

The logger is initialized in `src/main/utils/logger.ts`

The logs are written to the following file locations:

- **on Linux** : `~/.config/DataPup/logs/[YYYY-MM-DD].log`
- **on macOS** : `~/Library/Logs/DataPup/[YYYY-MM-DD].log`
- **on Windows** : `%USERPROFILE%\AppData\Roaming\DataPup\logs\[YYYY-MM-DD].log`

## Style Guide

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### TypeScript Style Guide

- Use TypeScript for all new code
- Follow the existing code style (we use Prettier)
- Use meaningful variable and function names
- Add types rather than using `any`
- Document complex logic with comments

### Component Guidelines

- Use functional components with hooks
- Keep components small and focused
- Use Radix UI components for consistency
- Follow accessibility best practices

## Project Structure

```
src/
├── main/           # Electron main process code
├── preload/        # Preload scripts
└── renderer/       # React application
    ├── components/ # React components
    ├── App.tsx     # Main App component
    ├── main.tsx    # React entry point
    └── index.html  # HTML template
```

## Where to Get Help

- **Discord**: Join our community (coming soon)
- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions

## Recognition

Contributors will be recognized in our README and release notes. We appreciate every contribution, no matter how small!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Data-Pup! 🐶✨
