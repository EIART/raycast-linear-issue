import fetch from "node-fetch";

import { AIParsedIssue } from "../types";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

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

export async function createLinearIssue(
  data: AIParsedIssue,
  linearKey: string,
) {
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
      "Unable to resolve a Linear team. Mention the team name explicitly in Additional Context.",
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
    { input },
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
      list.map((item) => item?.name).filter(Boolean),
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
        [],
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
  variables?: Record<string, unknown>,
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
