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
// TODO: verify `topPages` selection name against a live capture before relying on this
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
 * GET_JS_ERRORS: alias to GET_INSIGHTS_JS_ERRORS so the consumer's
 * metric-to-operation map can resolve "jsErrors" directly.
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
// TODO: provisional — capture from a live dashboard render and replace
export const GET_TOP_DEAD_CLICK_TARGETS: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — capture from a live dashboard render and replace */projectFeatures(id: $projectId) { id dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { topDeadClickTargets(skip: $skip, limit: $limit) { item count __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.dashboard.topDeadClickTargets",
};

/**
 * GET_TOP_CLICKED_ELEMENTS: provisional, see note above.
 */
// TODO: provisional — capture from a live dashboard render and replace
export const GET_TOP_CLICKED_ELEMENTS: Operation = {
  operationName: "getTopMetrics",
  query: "query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — capture from a live dashboard render and replace */projectFeatures(id: $projectId) { id dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { topClickedElements(skip: $skip, limit: $limit) { item count __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.dashboard.topClickedElements",
};

/**
 * LIST_CUSTOM_TAG_KEYS: provisional. The dashboard populates its tag-key
 * dropdown without firing a fresh GraphQL call in some sessions (likely
 * cached metadata). Field name and operation name are educated guesses;
 * verify against a live capture and replace if they differ.
 */
export const LIST_CUSTOM_TAG_KEYS: Operation = {
  operationName: "listCustomTagKeys",
  query: "query listCustomTagKeys($projectId: String!) { /* PROVISIONAL — verify via live capture */ projectFeatures(id: $projectId) { id customTagKeys __typename } }",
  responseExtractPath: "data.projectFeatures.customTagKeys",
};

/**
 * LIST_CUSTOM_TAG_VALUES: provisional. Mirrors LIST_CUSTOM_TAG_KEYS shape;
 * verify via live capture and replace if it differs.
 */
export const LIST_CUSTOM_TAG_VALUES: Operation = {
  operationName: "listCustomTagValues",
  query: "query listCustomTagValues($projectId: String!, $tagKey: String!) { /* PROVISIONAL — verify via live capture */ projectFeatures(id: $projectId) { id customTagValues(tagKey: $tagKey) __typename } }",
  responseExtractPath: "data.projectFeatures.customTagValues",
};

/**
 * GET_RECORDINGS: provisional. The recordings-list query is fired by the
 * dashboard's Recordings page; capture from a live render and replace.
 * `responseExtractPath` targets `recordings.items` based on the dashboard
 * pagination convention.
 */
export const GET_RECORDINGS: Operation = {
  operationName: "getRecordings",
  query: "query getRecordings($projectId: String!, $filters: String, $sortField: String, $limit: Int, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) { /* PROVISIONAL — verify via live capture */ projectFeatures(id: $projectId) { id recordings(filters: $filters, sortField: $sortField, limit: $limit, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) { items { link timestamp totalDuration activeDuration pagesCount sessionClickCount country device url __typename } __typename } __typename } }",
  responseExtractPath: "data.projectFeatures.recordings.items",
};

/**
 * GET_HEATMAP_TYPE_DATA: per-page-view heatmap data (clicks, scroll,
 * dead/rage/error clicks, etc.). The `heatmapType` integer selects the lens
 * — see src/dashboard/tools.ts for the mapping. `elementMapInfo` is
 * returned as a string-encoded JSON blob keyed by element hash; parse before
 * use. Returns null `heatmapTypeInfo` when there's no data for the filter
 * (treat as empty result). Captured verbatim under Playwright on 2026-05-06.
 */
export const GET_HEATMAP_TYPE_DATA: Operation = {
  operationName: "getHeatmapTypeData",
  query: "query getHeatmapTypeData($projectId: String!, $filter: String, $deviceType: Int, $version: String, $heatmapType: Int, $useHashAlpha: Boolean, $includePageQualityIssuesSessions: Boolean, $includeIncompleteSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    heatmapTypeInfo(serializedFilter: $filter, deviceType: $deviceType, version: $version, heatmapType: $heatmapType, useHashAlpha: $useHashAlpha, includePageQualityIssuesSessions: $includePageQualityIssuesSessions, includeIncompleteSessions: $includeIncompleteSessions) {\n      elementMapInfo\n      scrollMapInfo {\n        scrollReachY\n        cumulativeSum\n        percUsers\n        __typename\n      }\n      attentionMapInfo {\n        startElementHash\n        endElementHash\n        timeSpent\n        __typename\n      }\n      elementToShow\n      totalClicks\n      avgFold\n      pageViews\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.heatmapTypeInfo",
};

/**
 * GET_HEATMAP_PAYLOAD: page snapshot for a sample impression — width, height,
 * URL, and the raw mutation-event `payloads` Clarity uses to rebuild DOM in
 * the dashboard's heatmap iframe. We use it for `width`/`height` (needed for
 * coordinate normalization in click-elements output). The `payloads` array is
 * not consumed (would require implementing Clarity's player to extract DOM
 * structure / selectors).
 */
export const GET_HEATMAP_PAYLOAD: Operation = {
  operationName: "getHeatmapPayload",
  query: "query getHeatmapPayload($projectId: String!, $filter: String, $deviceType: Int, $useHashAlpha: Boolean, $includePageQualityIssuesSessions: Boolean, $includeIncompleteSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    heatmapPayload(serializedFilter: $filter, deviceType: $deviceType, useHashAlpha: $useHashAlpha, includePageQualityIssuesSessions: $includePageQualityIssuesSessions, includeIncompleteSessions: $includeIncompleteSessions) {\n      width\n      height\n      url\n      sampleImpression {\n        timestamp\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  responseExtractPath: "data.projectFeatures.heatmapPayload",
};
