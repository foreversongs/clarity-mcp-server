/**
 * Static map of GraphQL operations used against clarity.microsoft.com/api/v2.
 *
 * STRING SOURCES: All `query` values are lifted verbatim from the dashboard's
 * own network requests (captured under Playwright) and stored in
 * `scripts/captures/operations.json`. If the dashboard changes, re-capture
 * and update this file.
 *
 * GENERIC OPERATIONS: The dashboard reuses several `operationName` values
 * (notably `getInsightsMetrics`, `getSessionMetrics`, `getTopMetrics`) by
 * sending the same name with different field selections. We mirror that
 * here by exporting multiple `Operation` consts that share an `operationName`
 * but ship distinct `query` strings tailored to a specific metric.
 */

export interface Operation<V extends Record<string, unknown> = Record<string, unknown>> {
  operationName: string;
  query: string;
  /** Dotted path into the response body for the meaningful payload. */
  responseExtractPath: string;
  /**
   * Phantom marker so the generic type parameter `V` (variable shape) is
   * preserved at the type level. Always `undefined` at runtime; consumers
   * that want compile-time variable typing reference this via
   * `Operation<MyVars>`.
   */
  readonly __vars?: V;
}

// ---------------------------------------------------------------------------
// Captured operations (queries copied verbatim from operations.json)
// ---------------------------------------------------------------------------

export const GET_SESSIONS_INFO: Operation = {
  operationName: "getSessionsInfo",
  query: "query getSessionsInfo($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      sessions {\n        totalSessions\n        totalBotSessions\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.sessions",
};

export const GET_ENGAGEMENT_METRICS: Operation = {
  operationName: "getEngagementMetrics",
  query: "query getEngagementMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      engagement {\n        totalTime\n        activeTime\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.engagement",
};

export const GET_NEW_AND_RETURNING: Operation = {
  operationName: "getNewAndReturning",
  query: "query getNewAndReturning($projectId: String!, $filters: String, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      newAndReturning {\n        returningUsers\n        newUsers\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.newAndReturning",
};

export const GET_TOP_REFERRERS: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      referrers(skip: $skip, limit: $limit) {\n        item\n        count\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.referrers",
};

/**
 * GET_TOP_PAGES: provisional. The captured `getTopMetrics` shape is generic;
 * here we substitute the `referrers` selection with `topPages`. Field name
 * `topPages` is inferred from the dashboard schema but was not directly
 * observed in the capture pass — verify against live response and update
 * if the actual selection differs.
 */
// TODO(task-9): verify `topPages` selection against live dashboard response
export const GET_TOP_PAGES: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      topPages(skip: $skip, limit: $limit) {\n        item\n        count\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.topPages",
};

export const GET_INSIGHTS_FRICTION: Operation = {
  operationName: "getInsightsMetrics",
  query: "query getInsightsMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      rageClicks {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      deadClicks {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      excessiveScrolls {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      quickBacks {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard",
};

export const GET_INSIGHTS_JS_ERRORS: Operation = {
  operationName: "getInsightsMetrics",
  query: "query getInsightsMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      jsErrors {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.jsErrors",
};

export const GET_SCROLL_DEPTH: Operation = {
  operationName: "getSessionMetrics",
  query: "query getSessionMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      scrollDepth\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.scrollDepth",
};

/**
 * GET_DEAD_CLICKS: narrowed `getInsightsMetrics` selection that returns only
 * `deadClicks`. Same operationName as GET_INSIGHTS_FRICTION but a smaller
 * field set so the response can be extracted at a single dotted path.
 */
export const GET_DEAD_CLICKS: Operation = {
  operationName: "getInsightsMetrics",
  query: "query getInsightsMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      deadClicks {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.deadClicks",
};

/**
 * GET_RAGE_CLICKS: narrowed `getInsightsMetrics` selection that returns only
 * `rageClicks`.
 */
export const GET_RAGE_CLICKS: Operation = {
  operationName: "getInsightsMetrics",
  query: "query getInsightsMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      rageClicks {\n        pages\n        sessionsWith\n        sessionsWithout\n        subTotal\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.dashboard.rageClicks",
};

/**
 * GET_JS_ERRORS: alias to GET_INSIGHTS_JS_ERRORS so that Task 9's
 * METRIC_TO_OP map can resolve the metric name "jsErrors" directly.
 */
export const GET_JS_ERRORS: Operation = GET_INSIGHTS_JS_ERRORS;

// ---------------------------------------------------------------------------
// Provisional operations — NOT yet observed in capture
// ---------------------------------------------------------------------------

/**
 * GET_TOP_DEAD_CLICK_TARGETS: not observed in the capture pass. Schema is
 * inferred from the generic `getTopMetrics` shape; the implementer probing
 * live data must verify the field name and shape before relying on this.
 */
// TODO(task-9): capture from live dashboard
export const GET_TOP_DEAD_CLICK_TARGETS: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — not yet observed live, capture in Task 9's probe step */ projectFeatures(id: $projectId) { id dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { topDeadClickTargets(skip: $skip, limit: $limit) { item count __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.dashboard.topDeadClickTargets",
};

/**
 * GET_TOP_CLICKED_ELEMENTS: provisional, see note above.
 */
// TODO(task-9): capture from live dashboard
export const GET_TOP_CLICKED_ELEMENTS: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — not yet observed live, capture in Task 9's probe step */ projectFeatures(id: $projectId) { id dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { topClickedElements(skip: $skip, limit: $limit) { item count __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.dashboard.topClickedElements",
};

/**
 * LIST_CUSTOM_TAG_KEYS: per `operations.json._stillToCapture`, the dashboard
 * populates the tag-key dropdown without firing a fresh GraphQL call (likely
 * cached or part of getProjectSummary metadata). Provisional shape until the
 * real operation is captured live: assume a dedicated `customTagKeys` field on
 * `projectFeatures` returning an array of strings. Tool layer (`listCustomTags`)
 * is structured so swapping the operation later is a one-file change.
 */
// TODO(task-8): capture from live dashboard and replace this stub
export const LIST_CUSTOM_TAG_KEYS: Operation = {
  operationName: "listCustomTagKeys",
  query: "query listCustomTagKeys($projectId: String!) { /* PROVISIONAL — not yet observed live; field name and operation name are educated guesses based on the dashboard's tag-key dropdown. Replace once captured. */ projectFeatures(id: $projectId) { id customTagKeys __typename } }",
  responseExtractPath: "data.projectFeatures.customTagKeys",
};

/**
 * LIST_CUSTOM_TAG_VALUES: provisional placeholder. Task 11 implementer
 * should capture the actual operation when probing live data.
 */
// TODO(task-11): capture from live dashboard
export const LIST_CUSTOM_TAG_VALUES: Operation = {
  operationName: "getFilterOptions",
  query: "query getFilterOptions($projectId: String!, $filter: String!, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — not yet observed live, capture in Task 11's probe step */ projectFeatures(id: $projectId) { id filterOptions(serializedFilter: $filter, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { Variables __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.filterOptions.Variables",
};

/**
 * GET_RECORDINGS: per `operations.json._stillToCapture`, the recordings-list
 * query was not captured because the recordings page redirected to the
 * dashboard during the capture pass. Task 10 implementer should capture
 * this just-in-time by clicking "Go to recordings" from a dashboard card.
 *
 * `responseExtractPath` targets `recordings.items` to match the dashboard
 * contract (paginated list under `items`); the tool layer normalizes each
 * row's fields.
 */
// TODO(task-10): capture from live dashboard
export const GET_RECORDINGS: Operation = {
  operationName: "getRecordings",
  query: "query getRecordings($projectId: String!, $filters: String, $sortField: String, $limit: Int, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — not yet observed live, capture in Task 10's probe step */ projectFeatures(id: $projectId) { id recordings(filters: $filters, sortField: $sortField, limit: $limit, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { items { link timestamp totalDuration activeDuration pagesCount sessionClickCount country device url __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.recordings.items",
};
