// E18: live contract check. Fetches every endpoint a widget polls from the
// real server on :5017 and validates it with the schemas the client uses, so
// a backend shape change fails here before it shows "Unexpected data".
import { expect, test } from "@playwright/test";
import { ENDPOINT_SCHEMAS, HARDWARE_OPTIONAL } from "../../client/src/widgets/schemas";

for (const [url, schema] of Object.entries(ENDPOINT_SCHEMAS)) {
  test(`contract ${url}`, async ({ request }) => {
    const res = await request.get(url);
    if (HARDWARE_OPTIONAL.has(url) && res.status() >= 500) {
      test.info().annotations.push({ type: "skipped-hardware", description: `${url} → ${res.status()}` });
      return;
    }
    expect(res.status(), await res.text()).toBe(200);
    const parsed = schema.safeParse(await res.json());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))).toBe(true);
  });
}
