# Clarity Dashboard API Captures

Operation strings and filter-field mappings for the undocumented `clarity.microsoft.com/api/v2` GraphQL endpoint, captured by exercising the dashboard UI under Playwright observation.

## When to re-capture

Re-run the capture if:
- Tools start returning empty data or unexpected shapes
- The smoke test (`npm run probe`) fails with response-shape errors
- CloudWatch shows `extracted=false` in the per-call telemetry log lines
- Microsoft visibly changes the dashboard UI

## How to capture

1. Open the dashboard in Playwright-controlled Chrome:
   `https://clarity.microsoft.com/projects/view/<project-id>/dashboard`
2. Apply a custom-tag filter (e.g. `cro-cart-3way` = `1`) so that variant-aware ops fire alongside the standard ones.
3. Wait for all dashboard cards to render.
4. Pull all `POST /api/v2` network requests; for each unique `operationName`, record the body in `operations.json`.
5. Open the Recordings page with the same filter; record the recordings-list operation.
6. Apply each filter dimension individually (URL, device, country, etc.) and record the resulting `filters` envelope shape into `filter-fields.json`.

## Files

- `operations.json` — `{ operationName: { query, variableShape, responseExtractPath } }`
- `filter-fields.json` — `{ dimensionName: { field, dataType, operatorOptions } }`

These files are consumed by `src/dashboard/operations.ts` and `src/dashboard/filters.ts`.
