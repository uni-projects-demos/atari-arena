# Atari Arena

Evaluate & play trained models against Atari game engines, users & other models. Supports user vs game mode.

## Install

```bash
npm ci
```

## Dev

Serverless - Rust:

```bash
npm run dev:browser
```

With [atari-arena-api](https://github.com/uni-projects-demos/atari-arena-api) - Python:

```bash
npm run dev
```

## Build

Serverless - Rust:

```bash
npm run build:browser
npm run preview
```

With [atari-arena-api](https://github.com/uni-projects-demos/atari-arena-api) - Python:

```bash
npm run build
npm run preview
```

## Contribute

Before making a Pull Request, ensure it addresses an Issue, and verify the branch passes:

```bash
npm run verify:fix
```
