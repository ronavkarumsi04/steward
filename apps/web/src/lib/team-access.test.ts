import { expect, it } from "vitest";
import { scheduleAccess } from "./team-access";

it("lets members run existing schedules without editing their configuration", () => {
  expect(scheduleAccess("member")).toEqual({ edit: false, trigger: true });
  expect(scheduleAccess("viewer")).toEqual({ edit: false, trigger: false });
  expect(scheduleAccess(undefined)).toEqual({ edit: false, trigger: false });
  expect(scheduleAccess("owner")).toEqual({ edit: true, trigger: true });
});
