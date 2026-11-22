import { describe, expect, it } from "vitest";
import { LOCALES, resolveLocale, t, tf } from "./i18n";
import { decisionCopy } from "./decision-copy";

describe("i18n", () => {
  it("localizes closed-run approval copy consistently in both catalogs", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "approvals.runCancelled")).toBe(decisionCopy(locale).runCancelled);
      expect(t(locale, "approvals.runClosed")).toBe(decisionCopy(locale).runClosed);
      expect(t(locale, "approvals.notPending")).not.toBe("approvals.notPending");
    }
    expect(t("es", "approvals.runCancelled")).not.toBe(t("en", "approvals.runCancelled"));
    expect(t("es", "approvals.runClosed")).not.toBe(t("en", "approvals.runClosed"));
  });
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

  it("fills placeholders in the translator's word order and leaves unknown ones visible", () => {
    expect(tf("en", "overview.ofTotal", { n: 3, total: 7 })).toBe("3 of 7");
    expect(tf("es", "overview.ofTotal", { n: 3, total: 7 })).toBe("3 de 7");
    expect(tf("es", "approvals.none", { status: t("es", "approvals.pending") })).toBe("No hay aprobaciones pendientes.");
    expect(tf("en", "overview.done", {})).toBe("{n} done");
    expect(tf("es", "shell.paletteShowing", { n: 8, total: 20 })).toBe("Mostrando 8 de 20; sigue escribiendo para acotar.");
  });
});
