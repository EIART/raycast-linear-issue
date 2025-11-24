export type Prefs = {
  linearApiKey: string;
  useRaycastAI: boolean;
  openaiKey?: string;
};

export type AIParsedIssue = {
  title: string | null;
  description: string | null;
  owner: string | null;
  team: string | null;
  cycle: string | null;
  project: string | null;
};
