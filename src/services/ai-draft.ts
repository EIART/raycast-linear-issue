import { AI } from "@raycast/api";
import fetch from "node-fetch";
import JSON5 from "json5";

import { AIParsedIssue, Prefs } from "../types";

const OPENAI_CHAT_COMPLETIONS_ENDPOINT =
  "https://api.openai.com/v1/chat/completions";

export async function buildIssueDraft(
  userInput: string,
  selectedText: string,
  prefs: Prefs,
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
3. **字段推断**：owner、team、cycle、project 只接受输入中明确提到的中文或英文名称；找不到就返回 null。owner 请优先输出 Linear 中的显示名/英文 handle（例如 displayName 或邮箱前缀），若用户只给昵称，也要原样保留；team 支持 “team 用YYY / 团队：YYY”；project/cycle 同理。

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
  } catch {
    console.error("JSON parse failed:", cleanedRaw);
    throw new Error(
      `AI returned content that was not valid JSON. Full payload:\n${cleanedRaw || "(empty response)"}`,
    );
  }
}

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
