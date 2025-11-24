<div align="center">

# Linear Issue AI (Raycast Extension)

Generate high-quality Linear issues from any selected text without leaving Raycast.

</div>

## Overview

`raycast-linear-issue` is a Raycast extension that collects your selected text, optional notes, and uses Raycast AI (or OpenAI) to draft a structured Linear issue. It automatically maps AI output into Linear fields, looks up the right team/project/cycle IDs, and creates the issue via Linear's GraphQL API.

![Linear Issue AI](assets/list-icon.png)

## Key Features

- Convert selected text + extra context into a Linear issue in seconds.
- Choose Raycast AI or bring your own OpenAI API key.
- Automatic mapping of team/project/cycle names to Linear IDs.
- Friendly progress feedback via Raycast toasts.
- TypeScript + strict linting to keep the codebase maintainable.

## Requirements

- Raycast (with the Raycast CLI installed)
- Linear account with an API key
- Optional: OpenAI API key (only when not using Raycast AI)

## Getting Started

```bash
git clone https://github.com/<your-org>/raycast-linear-issue.git
cd raycast-linear-issue
npm install
```

### Run the extension locally

```bash
ray develop
```

Raycast will pick up the extension and let you trigger the **Create Linear Issue (AI)** command from the Raycast command palette.

## Configuration

Open Raycast → Extensions → Linear Issue AI → Preferences and fill in:

| Preference | Required | Description |
| --- | --- | --- |
| `Linear API Key` | ✅ | Create it in Linear → Settings → API |
| `Use Raycast AI` | Optional | When enabled, Raycast's built-in AI handles the prompt |
| `OpenAI API Key` | Optional | Only needed if `Use Raycast AI` is disabled |

## Usage

1. Select any text in your editor/browser that describes the issue.
2. Open Raycast, run **Create Linear Issue (AI)**.
3. Paste the selected text into **Selected Text** (or leave blank).
4. Add extra context in **Additional Context** if needed.
5. Submit — the extension calls AI, parses JSON, resolves Linear IDs, and creates the issue.

You will receive a success toast containing the newly created Linear issue URL.

## Troubleshooting

- **"AI returned invalid JSON"** – the AI sometimes wraps output in markdown fences. The extension strips common patterns, but if it still fails, rephrase the input.
- **"Team/project not found"** – make sure the AI output uses the exact team/project name. ID lookup is case-insensitive, but spelling matters.

## Development

Useful scripts:

```bash
npm run dev    # ray develop
npm run build  # ray build
npm run lint   # ray lint
```

The project uses TypeScript strict mode and Raycast's ESLint config.

## Roadmap

- Additional Linear fields (priority, labels, assignee).
- Better multi-language support.
- Smarter prompt that adapts to company-specific taxonomy.

## License

This project is licensed under the MIT License. See `LICENSE` for details.

