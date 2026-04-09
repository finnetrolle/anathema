export type JiraUser = {
  accountId?: string;
  key?: string;
  name?: string;
  displayName: string;
  emailAddress?: string;
};

export type JiraAssignee = JiraUser;

export type JiraIssueFields = {
  summary: string;
  project?: {
    id: string;
    key: string;
    name: string;
  } | null;
  issuetype?: {
    name: string;
  };
  status?: {
    name: string;
  };
  priority?: {
    name: string;
  };
  components?: Array<{
    name?: string;
  }>;
  creator?: JiraUser | null;
  reporter?: JiraUser | null;
  assignee?: JiraAssignee | null;
  duedate?: string | null;
  resolutiondate?: string | null;
  timeoriginalestimate?: number | null;
  aggregatetimeoriginalestimate?: number | null;
  created?: string;
  updated?: string;
  parent?: {
    id: string;
    key: string;
    fields?: {
      summary?: string;
    };
  } | null;
} & Record<string, unknown>;

export type JiraChangelogItem = {
  field: string;
  fromString?: string | null;
  toString?: string | null;
};

export type JiraChangelogHistory = {
  id: string;
  created: string;
  items: JiraChangelogItem[];
};

export type JiraIssue = {
  id: string;
  key: string;
  fields: JiraIssueFields;
  changelog?: {
    histories: JiraChangelogHistory[];
  };
};

export type JiraSearchResponse = {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
};

export type JiraFieldDefinition = {
  id: string;
  name: string;
  schema?: {
    type?: string;
    custom?: string;
  };
};
