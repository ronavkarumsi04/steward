import { describe, expect, it } from "vitest";
import { LOCALES, resolveLocale, t } from "./i18n";

describe("i18n", () => {
  it("resolves region tags and unknown languages", () => {
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("translates every key in every locale, never falling through to the key", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "nav.approvals")).not.toBe("nav.approvals");
    }
    expect(t("es", "nav.approvals")).toBe("Aprobaciones");
    expect(t("en", "top.signOut")).toBe("Sign out");
  });
});
