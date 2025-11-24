/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Linear API Key - Create a personal API key in Linear → Settings → API */
  "linearApiKey": string,
  /** Use Raycast AI - Toggle to use Raycast's built-in AI */
  "useRaycastAI": boolean,
  /** OpenAI API Key - Your OpenAI API key (only if not using Raycast AI) */
  "openaiKey"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `create-issue` command */
  export type CreateIssue = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `create-issue` command */
  export type CreateIssue = {}
}

