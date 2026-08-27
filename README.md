# Low-Latency STT App

A React Native mobile application built with **Expo**, designed for low-latency, on-device speech-to-text (STT).

---

## Getting Started

### 1. Install dependencies

After cloning the repository:

```bash
npm install
```

This installs all dependencies defined in `package.json`.
---

## Running the App

### Start Expo

```bash
npm run start
```

or:

```bash
npx expo start
```

This starts the Expo development server.

After starting, Expo provides options to open the application on a development build, Android emulator, iOS simulator, or Expo Go.

### Android

```bash
npm run android
```

This starts Expo with the Android target.

### iOS

```bash
npm run ios
```

This starts Expo with the iOS target.

### Web

```bash
npm run web
```

This starts the application in a web browser in localhost:8081.

> The primary target of this project is mobile. Web support is mainly useful for development and testing.

---


## Code Quality

### Lint

```bash
npm run lint
```

Runs ESLint across the project and checks for code-quality issues.

### Format

```bash
npm run format
```

Formats the project using Prettier.

This command modifies files when formatting changes are required.

### Check Formatting

```bash
npm run format:check
```

Checks whether files are correctly formatted without modifying them.

This is useful in CI because the build should fail if formatting is incorrect.

---

## Type Checking

Run TypeScript without generating output:

```bash
npx tsc --noEmit
```

This verifies that the project has no TypeScript type errors.

---

## Expo Diagnostics

Run Expo's project diagnostics:

```bash
npx expo-doctor
```

This checks the Expo project for common configuration and dependency problems.

---

## Project Validation

Before pushing changes, you can run:

```bash
npm run lint
npm run format:check
npx tsc --noEmit
npx expo-doctor
```

The same checks are also performed by GitHub Actions.

---

## Project Structure

```text
low-latency-stt-app/
│
├── app/                  # Expo Router screens and routes
├── assets/               # Images, fonts, and other static assets
├── scripts/              # Project utility scripts
│
├── .github/
│   └── workflows/        # GitHub Actions CI
│
├── app.json              # Expo configuration
├── package.json          # Dependencies and project scripts
├── package-lock.json     # Locked dependency versions
├── tsconfig.json         # TypeScript configuration
├── eslint.config.js      # ESLint configuration
├── .prettierrc           # Prettier configuration
├── .prettierignore       # Files ignored by Prettier
└── README.md             # Project documentation
```

---

## Git Workflow

The project uses Git for version control.

Create feature or setup branches instead of working directly on `main`.

Example:

```bash
git checkout -b feat/onnx-runtime
```

After making changes:

```bash
git status
git add .
git commit -m "feat: add ONNX Runtime"
```

Push the branch:

```bash
git push -u origin feat/onnx-runtime
```

Pull requests to `main` are automatically checked by GitHub Actions.

---

## CI

GitHub Actions runs the following checks:

1. Install dependencies
2. TypeScript type checking
3. ESLint
4. Prettier formatting check
5. Expo Doctor
6. Expo export/build validation

This ensures that changes merged into `main` meet the project's basic quality and build requirements.

---
