import React, { useEffect, useState } from "react";
import {
  ActionPanel,
  Action,
  Form,
  showToast,
  Toast,
  getPreferenceValues,
  Clipboard,
} from "@raycast/api";

import { buildIssueDraft } from "./services/ai-draft";
import { createLinearIssue } from "./services/linear-client";
import { Prefs } from "./types";

type FormValues = {
  selectedText?: string;
  userInput?: string;
};

export default function Command() {
  const prefs = getPreferenceValues<Prefs>();
  const [selectedTextValue, setSelectedTextValue] = useState("");
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrateFromClipboard() {
      try {
        const clipboardText = await Clipboard.readText();
        if (cancelled) return;

        if (clipboardText && clipboardText.trim()) {
          setSelectedTextValue(clipboardText.trim());
          setClipboardNotice(null);
        } else {
          setClipboardNotice("剪贴板中没有可用的文本，请手动粘贴或输入。");
        }
      } catch (error) {
        console.error("Failed to read clipboard", error);
        if (!cancelled) {
          setClipboardNotice("无法读取剪贴板内容，请手动粘贴。");
        }
      }
    }

    hydrateFromClipboard();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(values: FormValues) {
    const selectedText = (
      values.selectedText ??
      selectedTextValue ??
      ""
    ).trim();
    const userInput = values.userInput?.trim() ?? "";

    if (!selectedText && !userInput) {
      await showToast(
        Toast.Style.Failure,
        "Content required",
        "Add selected text or extra context so AI has material to work with.",
      );
      return;
    }

    if (!prefs.useRaycastAI && !prefs.openaiKey) {
      await showToast(
        Toast.Style.Failure,
        "Missing OpenAI key",
        "Provide an OpenAI API key or enable Raycast AI in preferences.",
      );
      return;
    }

    try {
      const toast = await showToast(Toast.Style.Animated, "Analyzing with AI…");

      const aiResult = await buildIssueDraft(userInput, selectedText, prefs);

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
      {clipboardNotice && <Form.Description text={clipboardNotice} />}
      <Form.TextArea
        id="selectedText"
        title="Selected Text"
        placeholder="Paste highlighted text or describe the bug/idea in your own words."
        value={selectedTextValue}
        onChange={setSelectedTextValue}
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
