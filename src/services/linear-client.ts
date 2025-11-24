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

  const teamId = await resolveTeamId(data.team, linearKey);
  const [projectId, cycleId, assigneeId] = await Promise.all([
    resolveProjectId(data.project, linearKey),
    resolveCycleId(data.cycle, teamId, linearKey),
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

async function resolveCycleId(
  name: string | null,
  teamId: string | null,
  apiKey: string,
) {
  if (name) {
    const cycleId = await findEntityId("cycles", name, apiKey);
    if (cycleId) {
      return cycleId;
    }
  }

  if (!teamId) {
    return null;
  }

  return fetchActiveCycleId(teamId, apiKey);
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

async function fetchActiveCycleId(teamId: string, apiKey: string) {
  const query = `
    query ActiveCycle($teamId: String!) {
      team(id: $teamId) {
        activeCycle {
          id
          name
        }
      }
    }
  `;

  const json = await linearGraphQLRequest<{
    team?: { activeCycle?: { id: string; name?: string } };
  }>(apiKey, query, { teamId });

  if (!json.team?.activeCycle?.id) {
    console.warn(
      `Team ${teamId} does not have an active cycle. Consider specifying one in the prompt.`,
    );
  } else {
    console.log(
      `Using active cycle '${json.team.activeCycle.name ?? ""}' for team ${teamId}.`,
    );
  }

  return json.team?.activeCycle?.id ?? null;
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

  console.log(
    "Linear team members payload:",
    candidates.users?.nodes ?? "No users returned",
  );

  const normalizedQuery = normalizeOwnerQuery(name);
  const user = selectBestUserMatch(
    normalizedQuery,
    candidates.users?.nodes ?? [],
  );

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

type LinearUser = {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
};

function selectBestUserMatch(query: string, users: LinearUser[]) {
  const querySlug = slugify(query);
  let bestUser: LinearUser | undefined;
  let bestScore = 0;

  for (const user of users) {
    const candidates = [
      user.name,
      user.displayName,
      user.email,
      user.email?.split("@")[0],
    ]
      .filter(Boolean)
      .map((value) => value!.trim().toLowerCase());

    const slugs = candidates.map(slugify);
    const combined = [...candidates, ...slugs];

    const score = combined.reduce((currentBest, candidate) => {
      if (!candidate) return currentBest;
      const candidateSlug = slugify(candidate);

      const directScore = scoreStrings(query, candidate);
      const slugScore = scoreStrings(querySlug, candidateSlug);
      return Math.max(currentBest, directScore, slugScore);
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestUser = user;
    }
  }

  if (bestUser) {
    console.log(
      `Selected assignee '${bestUser.name ?? bestUser.displayName}' for query '${query}' with score ${bestScore.toFixed(
        2,
      )}.`,
    );
  }

  const MIN_SCORE = 0.45;
  if (bestScore < MIN_SCORE) {
    return undefined;
  }

  return bestUser;
}

function slugify(value: string) {
  return value.replace(/[\s._-]+/g, "").toLowerCase();
}

function scoreStrings(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.85;
  if (a.includes(b) || b.includes(a)) return 0.75;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  return 1 - distance / maxLen;
}

function levenshteinDistance(a: string, b: string) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  matrix[0] = Array.from({ length: a.length + 1 }, (_, j) => j);

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
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
