import { describe, expect, it } from "vitest";
import { REQUIRED_AGREEMENTS, REQUIRED_VERSIONS, pendingAgreements } from "./agreements.js";
import { RETENTION_POLICY, legalConfigFromEnv, legalContact, sweptRules } from "./config.js";
import { LEGAL_DOCUMENTS, getDocument, interpolate, resolveDocument } from "./documents.js";
import { subprocessorsFromEnv } from "./subprocessors.js";

const cfg = legalConfigFromEnv({} as NodeJS.ProcessEnv);

describe("legal document set", () => {
  it("has a unique slug for every document", () => {
    const slugs = LEGAL_DOCUMENTS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("versions every document and gives it an effective date and sections", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.version, `${doc.slug} version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(doc.effectiveDate, `${doc.slug} effective date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.sections.length, `${doc.slug} sections`).toBeGreaterThan(2);
      expect(doc.summary.length, `${doc.slug} summary`).toBeGreaterThan(20);
      expect(new Set(doc.sections.map((s) => s.id)).size, `${doc.slug} section ids`).toBe(doc.sections.length);
    }
  });

  it("resolves every operator placeholder — nothing ships as {{token}}", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const resolved = resolveDocument(doc, cfg);
      const json = JSON.stringify(resolved);
      expect(json, `${doc.slug} has an unresolved placeholder`).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    }
  });

  it("interpolates repeated tokens, not just the first occurrence", () => {
    expect(interpolate("{{serviceName}} and {{serviceName}}", cfg)).toBe("Steward and Steward");
  });

  it("does not leave development markers in shipped text", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const text = JSON.stringify(resolveDocument(doc, cfg)).toLowerCase();
      for (const marker of ["todo", "tbd", "lorem ipsum", "xxx", "placeholder text"]) {
        expect(text, `${doc.slug} contains "${marker}"`).not.toContain(marker);
      }
    }
  });

  it("mentions certifications only to disclaim them", () => {
    const text = JSON.stringify(LEGAL_DOCUMENTS.map((d) => resolveDocument(d, cfg)));
    const mentions = [...text.matchAll(/(soc\s?2|iso\/?iec\s?27001)[^.]{0,90}/gi)];
    // There is at least one mention, and every mention is inside a negating sentence.
    expect(mentions.length).toBeGreaterThan(0);
    for (const match of mentions) {
      expect(match[0].toLowerCase(), `unnegated certification claim: ${match[0]}`).toMatch(/\b(not|no|never|without|does not|do not)\b/);
    }
  });

  it("states plainly that no certification is held, and claims no entity", () => {
    const security = resolveDocument(getDocument("security")!, cfg);
    const text = JSON.stringify(security);
    expect(text).toMatch(/not SOC 2 certified/i);
    expect(text).toMatch(/not ISO 27001 certified/i);
    expect(text.toLowerCase()).toContain("no certification claims");

    const everything = JSON.stringify(LEGAL_DOCUMENTS.map((d) => resolveDocument(d, cfg)));
    expect(everything).not.toContain("incorporated under");
  });
});

describe("clickwrap registry", () => {
  it("requires exactly the contract documents, each marked requiresAcceptance", () => {
    expect([...REQUIRED_AGREEMENTS]).toEqual(["terms", "privacy", "acceptable-use"]);
    for (const slug of REQUIRED_AGREEMENTS) {
      const doc = getDocument(slug);
      expect(doc, `${slug} exists`).toBeDefined();
      expect(doc?.requiresAcceptance, `${slug} is part of the clickwrap`).toBe(true);
      expect(REQUIRED_VERSIONS[slug]).toBe(doc?.version);
    }
  });

  it("treats a fresh account as needing every acceptance", () => {
    const pending = pendingAgreements([]);
    expect(pending.map((p) => p.document)).toEqual([...REQUIRED_AGREEMENTS]);
    expect(pending.every((p) => p.acceptedVersion === null)).toBe(true);
  });

  it("re-prompts when a document version moves", () => {
    const accepted = REQUIRED_AGREEMENTS.map((document) => ({ document, version: REQUIRED_VERSIONS[document], acceptedAt: new Date() }));
    expect(pendingAgreements(accepted)).toHaveLength(0);

    const stale = accepted.map((a) => (a.document === "terms" ? { ...a, version: "0.0.1" } : a));
    const pending = pendingAgreements(stale);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ document: "terms", acceptedVersion: "0.0.1", requiredVersion: REQUIRED_VERSIONS.terms });
  });

  it("accepts the most recent version when several are recorded", () => {
    const accepted = [
      { document: "terms", version: "0.0.1", acceptedAt: new Date("2026-01-01") },
      { document: "terms", version: REQUIRED_VERSIONS.terms, acceptedAt: new Date("2026-02-01") },
      { document: "privacy", version: REQUIRED_VERSIONS.privacy, acceptedAt: new Date() },
      { document: "acceptable-use", version: REQUIRED_VERSIONS["acceptable-use"], acceptedAt: new Date() },
    ];
    expect(pendingAgreements(accepted)).toHaveLength(0);
  });
});

describe("retention policy", () => {
  it("declares a purpose, storage location, and deletion behaviour for every rule", () => {
    for (const rule of RETENTION_POLICY) {
      expect(rule.data.length, rule.id).toBeGreaterThan(5);
      expect(rule.storage.length, rule.id).toBeGreaterThan(3);
      expect(rule.purpose.length, rule.id).toBeGreaterThan(10);
      expect(rule.retention.length, rule.id).toBeGreaterThan(5);
      expect(rule.onDeletion.length, rule.id).toBeGreaterThan(5);
    }
  });

  it("keeps ids unique and windows positive", () => {
    const ids = RETENTION_POLICY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of sweptRules()) expect(rule.sweepDays, rule.id).toBeGreaterThan(0);
  });

  it("keeps suppression records after deletion, because opt-outs outlive accounts", () => {
    const suppression = RETENTION_POLICY.find((r) => r.id === "suppression");
    expect(suppression?.sweepDays).toBeNull();
    expect(suppression?.onDeletion.toLowerCase()).toContain("kept");
  });

  it("does not expire the audit trail on a timer", () => {
    expect(RETENTION_POLICY.find((r) => r.id === "run_history")?.sweepDays).toBeNull();
    expect(RETENTION_POLICY.find((r) => r.id === "audit_log")?.sweepDays).toBeNull();
  });
});

describe("subprocessor register", () => {
  it("reports only vendors that are actually switched on", () => {
    const byId = (env: NodeJS.ProcessEnv) => new Map(subprocessorsFromEnv(env).map((s) => [s.id, s]));

    const bare = byId({} as NodeJS.ProcessEnv);
    expect(bare.get("hosting")?.status).toBe("not active");
    expect(bare.get("hosting")?.name).not.toContain("Vercel");
    expect(bare.get("email")?.status).toBe("not active");
    expect(bare.get("workflow")?.name).toContain("Operator-managed");

    const configured = byId({ VERCEL: "1", PLATFORM_EMAIL_PROVIDER: "resend", TEMPORAL_API_KEY: "key" } as NodeJS.ProcessEnv);
    expect(configured.get("hosting")?.name).toContain("Vercel");
    expect(configured.get("hosting")?.status).toBe("in use");
    expect(configured.get("email")?.name).toBe("Resend");
    expect(configured.get("workflow")?.name).toContain("Temporal Cloud");
  });

  it("names the operator's own database when it is configured", () => {
    const list = subprocessorsFromEnv({ LEGAL_DATABASE_PROVIDER: "Acme Managed Postgres" } as NodeJS.ProcessEnv);
    expect(list.find((s) => s.id === "database")?.name).toBe("Acme Managed Postgres");
  });

  it("includes operator-declared extras", () => {
    const list = subprocessorsFromEnv({ LEGAL_ADDITIONAL_SUBPROCESSORS: "Acme Logs|Error tracking|Stack traces|EU" } as NodeJS.ProcessEnv);
    const extra = list.find((s) => s.id === "extra");
    expect(extra?.name).toBe("Acme Logs");
    expect(extra?.role).toBe("Error tracking");
    expect(extra?.location).toBe("EU");
  });

  it("keeps customer-connected providers out of the subprocessor list", () => {
    const list = subprocessorsFromEnv({} as NodeJS.ProcessEnv).map((s) => s.name.toLowerCase()).join(" ");
    for (const vendor of ["openai", "anthropic", "stripe", "slack", "github", "twilio", "hubspot"]) {
      expect(list, `${vendor} must not be listed as our subprocessor`).not.toContain(vendor);
    }
  });
});

describe("legal contact", () => {
  it("discloses missing contact configuration instead of treating a private repository as a public channel", () => {
    expect(legalContact(cfg)).toContain("not configured");
    expect(legalContact(cfg)).not.toContain("github.com");
    const withEmail = legalConfigFromEnv({ LEGAL_CONTACT_EMAIL: "privacy@example.com" } as NodeJS.ProcessEnv);
    expect(legalContact(withEmail)).toBe("privacy@example.com");
  });

  it("names a real entity when the operator supplies one", () => {
    const withEntity = legalConfigFromEnv({ LEGAL_ENTITY_NAME: "Steward Labs, Inc." } as NodeJS.ProcessEnv);
    expect(withEntity.operator).toContain("Steward Labs, Inc.");
    expect(withEntity.legalEntityName).toBe("Steward Labs, Inc.");
  });

  it("names the database vendor the deployment actually connects to", () => {
    // A published subprocessor page that names the wrong vendor is worse than one that names none.
    const hosted = subprocessorsFromEnv({
      DATABASE_URL: "postgresql://app.pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    } as NodeJS.ProcessEnv);
    const db = hosted.find((s) => s.id === "database")!;
    expect(db.name).toContain("Supabase");
    expect(db.location).toContain("N. Virginia");
    expect(db.location).toContain("us-east-1");

    const selfHosted = subprocessorsFromEnv({ DATABASE_URL: "postgresql://app@db.internal:5432/steward" } as NodeJS.ProcessEnv);
    const own = selfHosted.find((s) => s.id === "database")!;
    expect(own.name).toBe("Operator-managed PostgreSQL");
    expect(own.location).toBe("db.internal");

    // An explicit override still wins, so operators can correct the description themselves.
    const overridden = subprocessorsFromEnv({
      DATABASE_URL: "postgresql://app@db.internal:5432/steward",
      LEGAL_DATABASE_PROVIDER: "Acme Managed Postgres",
    } as NodeJS.ProcessEnv);
    expect(overridden.find((s) => s.id === "database")!.name).toBe("Acme Managed Postgres");
  });

  it("does not crash on a malformed connection string", () => {
    const rows = subprocessorsFromEnv({ DATABASE_URL: "not a url" } as NodeJS.ProcessEnv);
    expect(rows.find((s) => s.id === "database")!.name).toBe("Operator-managed PostgreSQL");
  });
});


describe("proprietary identity revision", () => {
  it("requires fresh acceptance of prior public versions without erasing history", () => {
    const history = REQUIRED_AGREEMENTS.map((document) => ({ document, version: "1.0.0", acceptedAt: new Date("2026-09-25") }));
    expect(pendingAgreements(history).map((item) => item.document)).toEqual(REQUIRED_AGREEMENTS);
    expect(pendingAgreements(history).every((item) => item.acceptedVersion === "1.0.0")).toBe(true);
    expect(history.every((record) => record.version === "1.0.0")).toBe(true);
    expect(REQUIRED_VERSIONS.terms).toBe("2.0.0");
    expect(REQUIRED_VERSIONS.privacy).toBe("1.1.0");
  });
  it("reserves product source while preserving third-party grants and identifying the actual operator", () => {
    const terms = JSON.stringify(resolveDocument(getDocument("terms")!, cfg));
    const notices = JSON.stringify(resolveDocument(getDocument("third-party-notices")!, cfg));
    expect(terms).toContain("proprietary, closed-source");
    expect(terms).toContain("Ronav Karumsi");
    expect(terms).not.toContain("maintainers");
    expect(terms).not.toContain("Apache");
    expect(notices).toContain("Third-party license grants and required notices remain intact");
    expect(cfg.legalEntityName).toBeNull();
    const support = JSON.stringify(resolveDocument(getDocument("support")!, cfg));
    expect(support).toContain("not configured");
    expect(support).not.toContain("github.com");
    expect(support).not.toContain("Community-driven");
    const privacy = JSON.stringify(resolveDocument(getDocument("privacy")!, cfg));
    expect(privacy).toContain("separate deployment requires a written agreement");
    const retention = JSON.stringify(resolveDocument(getDocument("retention")!, cfg));
    expect(retention).toContain("production backup coverage and restoration remain unverified");
  });
});
