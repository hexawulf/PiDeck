// PD-19: temperature alert hysteresis.
import { describe, expect, it } from "vitest";
import { temperatureVerdict } from "../../server/services/alerts";

describe("temperatureVerdict", () => {
  it.each([
    // temp, streak before → active, streak after
    [75, 0, null, 1],
    [75, 1, true, 2],
    [70.1, 5, true, 6],
    [70, 3, null, 0], // at the threshold: hold
    [68, 0, null, 0],
    [67.1, 0, null, 0],
    [67, 4, false, 0],
    [40, 0, false, 0],
  ])("%s °C after %s hot → %s", (t, before, active, after) => {
    expect(temperatureVerdict(t, before)).toEqual({ active, hotStreak: after });
  });

  it("no usable reading resolves, as before", () => {
    for (const t of [undefined, null, "75", NaN]) expect(temperatureVerdict(t, 3)).toEqual({ active: false, hotStreak: 0 });
  });
});
