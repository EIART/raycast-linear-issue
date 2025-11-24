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

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const OPENAI_CHAT_COMPLETIONS_ENDPOINT =
  "https://api.openai.com/v1/chat/completions";

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

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message?: string }[];
};

type IssueCreatePayload = {
  issueCreate?: {
    issue?: {
      url: string;
    };
  };
};

type IssueCreateInput = {
  title: string;
  description: string;
  teamId: string;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
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
        "Add selected text or extra context so AI has material to work with."
      );
      return;
    }

    if (!prefs.useRaycastAI && !prefs.openaiKey) {
      await showToast(
        Toast.Style.Failure,
        "Missing OpenAI key",
        "Provide an OpenAI API key or enable Raycast AI in preferences."
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
      <Form.Description text="Share the raw signal (selected text) plus optional context so AI can draft a clear Linear issue." />
      <Form.TextArea
        id="selectedText"
        title="Selected Text"
        placeholder="Paste highlighted text or describe the bug/idea in your own words."
        enableMarkdown
      />
      <Form.TextArea
        id="userInput"
        title="Additional Context"
        placeholder="Optional: owner, team, desired outcome, blockers…"
        enableMarkdown
      />
    </Form>
  );
}

// Ask Raycast AI or OpenAI to transform free-form text into a structured issue.
async function callAI(
  userInput: string,
  selectedText: string,
  prefs: Prefs
): Promise<AIParsedIssue> {
  const prompt = `
You are Linear Issue Synthesizer, an expert TPM who rewrites messy notes into ready-to-create Linear tickets for a Chinese-speaking team.

You always receive two sections:
A) Selected Text → raw logs, requirements或笔记，可能为空。
B) Reporter Instructions → 执行人、团队、优先级等快速指令，也可能为空。

优先级：
1. Selected Text 是事实来源。
2. 指令明确指出 owner / team / project 等时必须采纳。
3. 没有信息时，保持保守并提示“待补充”。

任务：
1. **标题**：12 个中文词以内，专业语气，不用 emoji。若缺少上下文，使用“待补充的 issue 描述”并说明需补资料。
2. **描述**：用 Markdown（中文）并保持以下小节：Summary、Steps / What Happened、Expected、Actual / Impact、Additional Context。若某部分缺信息，写出需要的信息而非捏造内容。
3. **字段推断**：owner、team、cycle、project 只接受输入中明确提到的中文或英文名称；找不到就返回 null。owner 支持 “给XXX / assign to XXX”；team 支持 “team 用YYY / 团队：YYY”；project/cycle 同理。

输出必须是严格 JSON（无 Markdown 包裹），schema：
{
  "title": "",
  "description": "",
  "owner": "",
  "team": "",
  "cycle": "",
  "project": ""
}

规则：
- 仅输出 JSON，不要解释。
- 描述<300字，使用简体中文。
- 如果输入里出现“芦笋录屏”“yansoul”等自定义名词，保持原样。
- 当字段为 null 时，在 Additional Context 段落写明还缺哪些信息。

示例：
Selected Text: “修复控制台崩溃”
Reporter Instructions: “给 yansoul，team 用芦笋录屏”
输出 owner: "yansoul", team: "芦笋录屏", 其它 unknown 设为 null。
`;

  const input = `
=== Selected Text ===
${selectedText || "(空)"}

=== Reporter Instructions ===
${userInput || "(空)"}

Return JSON only:
`;

  let raw = "";

  if (prefs.useRaycastAI) {
    raw = await AI.ask(prompt + input, {
      creativity: 0.3,
    });
  } else {
    const resp = await fetch(OPENAI_CHAT_COMPLETIONS_ENDPOINT, {
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

  let cleanedRaw = raw.trim();

  try {
    const codeBlockMatch = cleanedRaw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleanedRaw = codeBlockMatch[1];
    }

    console.log("AI raw payload:", cleanedRaw);
    const parsed = JSON5.parse(cleanedRaw) as Partial<AIParsedIssue>;
    console.log("AI parsed payload:", parsed);
    return normalizeAIResult(parsed);
  } catch (err) {
    console.error("JSON parse failed:", cleanedRaw);
    throw new Error(
      `AI returned content that was not valid JSON. Full payload:\n${cleanedRaw || "(empty response)"}`
    );
  }
}

// Guard against missing fields and always return the expected object shape.
function normalizeAIResult(data: Partial<AIParsedIssue>): AIParsedIssue {
  return {
    title: sanitizeStringField(data?.title),
    description: sanitizeStringField(data?.description),
    owner: sanitizeStringField(data?.owner),
    team: sanitizeStringField(data?.team),
    cycle: sanitizeStringField(data?.cycle),
    project: sanitizeStringField(data?.project),
  };
}

function sanitizeStringField(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

  const [teamId, projectId, cycleId, assigneeId] = await Promise.all([
    resolveTeamId(data.team, linearKey),
    resolveProjectId(data.project, linearKey),
    resolveCycleId(data.cycle, linearKey),
    resolveAssigneeId(data.owner, linearKey),
  ]);

  if (!teamId) {
    throw new Error(
      "Unable to resolve a Linear team. Mention the team name explicitly in Additional Context."
    );
  }

  const input: IssueCreateInput = {
    title: data.title ?? "AI generated issue",
    description: data.description ?? "",
    teamId,
  };

  if (projectId) {
    input.projectId = projectId;
  }

  if (cycleId) {
    input.cycleId = cycleId;
  }
  if (assigneeId) {
    input.assigneeId = assigneeId;
  }

  const json = await linearGraphQLRequest<IssueCreatePayload>(
    linearKey,
    query,
    { input }
  );

  const url = json.issueCreate?.issue?.url;
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

async function resolveAssigneeId(name: string | null, apiKey: string) {
  if (!name) return null;
  return findUserId(name, apiKey);
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

  const json = await linearGraphQLRequest<
    Record<string, { nodes?: { id: string; name: string }[] }>
  >(apiKey, query);

  const normalized = name.trim().toLowerCase();
  const list = json?.[entity]?.nodes ?? [];
  const match = list.find((item) => {
    if (!item?.name) {
      return false;
    }
    return item.name.trim().toLowerCase() === normalized;
  });

  if (!match) {
    console.warn(
      `Could not resolve ${entity} '${name}'. Available options:`,
      list.map((item) => item?.name).filter(Boolean)
    );
  }

  return match?.id ?? null;
}

async function findUserId(name: string, apiKey: string) {
  const query = `
    query UsersForAssignment {
      users(first: 100) {
        nodes {
          id
          name
          displayName
          email
        }
      }
    }
  `;

  const candidates = await linearGraphQLRequest<{
    users?: {
      nodes?: {
        id: string;
        name?: string;
        displayName?: string;
        email?: string;
      }[];
    };
  }>(apiKey, query);

  const normalized = normalizeOwnerQuery(name);
  const user = candidates.users?.nodes?.find((node) => {
    const values = [
      node.name,
      node.displayName,
      node.email,
      node.email?.split("@")[0],
    ]
      .filter(Boolean)
      .map((value) => value!.trim().toLowerCase());
    return values.includes(normalized);
  });

  if (!user) {
    console.warn(
      `Could not resolve assignee '${name}'. Checked users:`,
      candidates.users?.nodes?.map((node) => node.name ?? node.displayName) ??
        []
    );
  }

  return user?.id ?? null;
}

function normalizeOwnerQuery(value: string) {
  return value.replace(/^@/, "").trim().toLowerCase();
}

async function linearGraphQLRequest<TData>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
) {
  console.log("Linear request →", LINEAR_GRAPHQL_ENDPOINT, {
    variables,
  });

  const resp = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    throw new Error(`Linear request failed (${resp.status})`);
  }

  const json = (await resp.json()) as GraphQLResponse<TData>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((err) => err.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Linear response did not include data");
  }

  return json.data;
}
