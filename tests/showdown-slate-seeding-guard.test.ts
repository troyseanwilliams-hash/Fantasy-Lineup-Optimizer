import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the daily refresh seeds every available NFL Showdown draft group", () => {
  const routesSource = readFileSync(
    new URL("../server/routes.ts", import.meta.url),
    "utf8",
  );
  const showdownSection = routesSource.slice(
    routesSource.indexOf('const todayShowdowns = await fetchAvailableDKShowdowns("NFL")'),
    routesSource.indexOf("const refreshedSlates = await storage.getSlates()"),
  );

  assert.match(showdownSection, /for \(const showdown of todayShowdowns\)/);
  assert.doesNotMatch(showdownSection, /todayShowdowns\[0\]/);
  assert.match(showdownSection, /draftGroupId === showdown\.draftGroupId/);
  assert.match(showdownSection, /isActive: true/);
  assert.match(showdownSection, /toLocaleTimeString\("en-US"/);
  assert.match(showdownSection, /name: showdownLabel/);
  assert.match(showdownSection, /label: showdownLabel/);
});