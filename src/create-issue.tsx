import React from "react";
import {
  ActionPanel,
  Action,
  Form,
  showToast,
  Toast,
  getPreferenceValues,
  AI,
} from "@raycast/api";
import fetch from "node-fetch";
import JSON5 from "json5";

type Prefs = {
  linearApiKey: string;
  useRaycastAI: boolean;
  openaiKey?: string;
};

type AIParsedIssue = {
  title: string | null;
  description: string | null;
  owner: string | null;
  team: string | null;
  cycle: string | null;
  project: string | null;
};

type FormValues = {
  selectedText?: string;
  userInput?: string;
};

export default function Command() {
  const prefs = getPreferenceValues<Prefs>();

  async function handleSubmit(values: FormValues) {
    const selectedText = values.selectedText?.trim() ?? "";
    const userInput = values.userInput?.trim() ?? "";

    if (!selectedText && !userInput) {
      await showToast(
        Toast.Style.Failure,
        "Content required",
        "Add selected text or additional context.",
      );
      return;
    }

    try {
      const toast = await showToast(Toast.Style.Animated, "Analyzing with AI…");

      const aiResult = await callAI(userInput, selectedText, prefs);

      toast.message = "Creating issue…";

      const issueUrl = await createLinearIssue(aiResult, prefs.linearApiKey);

      toast.style = Toast.Style.Success;
      toast.title = "Issue created";
      toast.message = issueUrl;
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      await showToast(Toast.Style.Failure, "Failed to create issue", message);
    }
  }

  return (
    <Form
      navigationTitle="Create Linear Issue (AI)"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Issue" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Paste highlighted text and add context so AI can craft a great Linear issue." />
      <Form.TextArea
        id="selectedText"
        title="Selected Text"
        placeholder="Paste the text you highlighted or describe the problem."
      />
      <Form.TextArea
        id="userInput"
        title="Additional Context"
        placeholder="Optional: owner, team, desired outcome, blockers…"
      />
    </Form>
  );
}

// Ask Raycast AI or OpenAI to transform free-form text into a structured issue.
async function callAI(
  userInput: string,
  selectedText: string,
  prefs: Prefs,
): Promise<AIParsedIssue> {
  const prompt = `
You are an assistant that extracts Linear issue details.
You will receive:
1. Selected text (may become part of the description)
2. User-provided context (any format)

Return ONLY strict JSON with this shape:
{
  "title": "",
  "description": "",
  "owner": "",
  "team": "",
  "cycle": "",
  "project": ""
}

Rules:
- Respond with raw JSON, no explanation.
- Use null for unknown fields.
- Description must blend selected text + user context.
- Keep the title concise and professional.
`;

  const input = `
=== Selected Text ===
${selectedText}

=== Additional Context ===
${userInput}

Return JSON only:
`;

  let raw = "";

  if (prefs.useRaycastAI) {
    raw = await AI.ask(prompt + input, {
      creativity: 0.3,
    });
  } else {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${prefs.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt + input }],
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI request failed (${resp.status})`);
    }

    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    raw = json.choices?.[0]?.message?.content ?? "";
  }

  try {
    let cleanedRaw = raw.trim();
    const codeBlockMatch = cleanedRaw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleanedRaw = codeBlockMatch[1];
    }

    const parsed = JSON5.parse(cleanedRaw) as Partial<AIParsedIssue>;
    return normalizeAIResult(parsed);
  } catch (err) {
    console.error("JSON parse failed:", raw);
    throw new Error(
      "AI returned content that was not valid JSON. Try rephrasing your input.",
    );
  }
}

// Guard against missing fields and always return the expected object shape.
function normalizeAIResult(data: Partial<AIParsedIssue>): AIParsedIssue {
  return {
    title: data?.title ?? null,
    description: data?.description ?? null,
    owner: data?.owner ?? null,
    team: data?.team ?? null,
    cycle: data?.cycle ?? null,
    project: data?.project ?? null,
  };
}

// Create a Linear issue and map AI result to concrete IDs.
async function createLinearIssue(data: AIParsedIssue, linearKey: string) {
  const query = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue {
          id
          title
          url
        }
      }
    }
  `;

  const input = {
    title: data.title ?? "AI generated issue",
    description: data.description ?? "",
    teamId: await resolveTeamId(data.team, linearKey),
    projectId: await resolveProjectId(data.project, linearKey),
    cycleId: await resolveCycleId(data.cycle, linearKey),
  };

  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: linearKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { input } }),
  });

  if (!resp.ok) {
    throw new Error(`Linear request failed (${resp.status})`);
  }

  const json = (await resp.json()) as {
    errors?: { message?: string }[];
    data?: { issueCreate?: { issue?: { url: string } } };
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((err) => err.message).join("; "));
  }

  const url = json.data?.issueCreate?.issue?.url;
  if (!url) {
    throw new Error("Linear returned an unexpected response");
  }

  return url;
}

async function resolveTeamId(name: string | null, apiKey: string) {
  if (!name) return null;
  return findEntityId("teams", name, apiKey);
}

async function resolveProjectId(name: string | null, apiKey: string) {
  if (!name) return null;
  return findEntityId("projects", name, apiKey);
}

async function resolveCycleId(name: string | null, apiKey: string) {
  if (!name) return null;
  return findEntityId("cycles", name, apiKey);
}

async function findEntityId(entity: string, name: string, apiKey: string) {
  const query = `
    query {
      ${entity} {
        nodes {
          id
          name
        }
      }
    }
  `;

  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${entity} from Linear (${resp.status})`);
  }

  const json = (await resp.json()) as {
    data?: Record<string, { nodes?: { id: string; name: string }[] }>;
  };

  const list = json.data?.[entity]?.nodes ?? [];
  const match = list.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  return match?.id ?? null;
}
