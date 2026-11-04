"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  BRAND_ACCENT_HEX,
  BRAND_FONT_STACK,
  BRAND_MARKS,
  BRAND_RADIUS_CSS,
  SITE_ACCENTS,
  SITE_FONTS,
  SITE_RADII,
  brandKitDecided,
  emptyBrandKit,
  monogram,
  type BrandKit,
  type CompanyProfile,
} from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Company } from "@/lib/types";

const FONT_LABEL = { sans: "Sans", serif: "Serif", mono: "Mono" } as const;
const RADIUS_LABEL = { sharp: "Sharp", soft: "Soft", round: "Round" } as const;
const MARK_LABEL = { wordmark: "Wordmark", monogram: "Monogram" } as const;

function words(raw: string): string[] {
  return raw.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

/** Why a kit cannot be saved as typed, in the founder's terms; null when it can. Mirrors the schema limits. */
export function brandKitProblem(kit: BrandKit): string | null {
  if (kit.voice.tone.length > 5) return `Up to five tone words — remove ${kit.voice.tone.length - 5}.`;
  if (kit.voice.do.length > 8) return `Up to eight "do" lines — remove ${kit.voice.do.length - 8}.`;
  if (kit.voice.dont.length > 8) return `Up to eight "don't" lines — remove ${kit.voice.dont.length - 8}.`;
  const long = [...kit.voice.tone, ...kit.voice.do, ...kit.voice.dont].find((w) => w.length > 80);
  if (long) return `"${long.slice(0, 24)}…" is over 80 characters.`;
  return null;
}

/**
 * How the brand kit will look where it is actually used: the top of the company's own site. Rendered with the
 * site's real CSS values (the same hex, stack and radius the published page gets), not an approximation.
 */
export function BrandPreview({ kit, name }: { kit: BrandKit; name: string }) {
  const accent = BRAND_ACCENT_HEX[kit.accent];
  const ink = kit.dark ? "#f5f5f4" : "#18181b";
  const muted = kit.dark ? "#a8a29e" : "#52525b";
  const page = kit.dark ? "#0c0a09" : "#ffffff";
  const line = kit.dark ? "#292524" : "#e7e5e4";
  const radius = BRAND_RADIUS_CSS[kit.radius];
  return (
    <div data-testid="brand-preview" aria-label={`Preview of ${name} in ${kit.accent} on ${kit.dark ? "dark" : "light"}`} className="overflow-hidden border border-line" style={{ background: page, color: ink, fontFamily: BRAND_FONT_STACK[kit.font] }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${line}` }}>
        <span className="flex items-center gap-2 font-bold">
          {kit.mark === "monogram" ? (
            <span className="inline-flex h-7 w-7 items-center justify-center text-xs font-bold text-white" style={{ background: accent, borderRadius: radius }}>{monogram(name) || "?"}</span>
          ) : null}
          <span>{name}</span>
        </span>
        <span className="text-xs" style={{ color: accent }}>Contact</span>
      </div>
      <div className="px-4 py-5">
        <p className="text-lg font-semibold leading-snug">{kit.tagline || "What this company does, in one line"}</p>
        <p className="mt-1 text-sm" style={{ color: muted }}>{kit.voice.tone.length ? `Sounds ${kit.voice.tone.join(", ")}.` : "Add a few tone words to hear the voice."}</p>
        <span className="mt-3 inline-block px-3 py-1.5 text-sm font-medium text-white" style={{ background: accent, borderRadius: radius }}>Get in touch</span>
      </div>
    </div>
  );
}

export function BrandKitSettings({ company, profile }: { company: Company; profile: CompanyProfile | null }) {
  const router = useRouter();
  const [kit, setKit] = useState<BrandKit>(() => profile?.brand ?? emptyBrandKit());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = profile?.name || company.name;

  function patch(next: Partial<BrandKit>) {
    setSaved(false);
    setKit((k) => ({ ...k, ...next }));
  }

  const problem = brandKitProblem(kit);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base: CompanyProfile = profile ?? {
        name: company.name, tagline: "", description: "", stage: "idea", businessModel: "", targetCustomers: [], valueProposition: "",
        products: [], competitors: [], channels: [], brandVoice: "", goals: [], constraints: [], techStack: [], brand: emptyBrandKit(),
      };
      await browserApi.put(`/companies/${company.id}/profile`, { ...base, brand: kit });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the brand kit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card nb-left-purple space-y-4" aria-labelledby="brand-kit-heading">
      <div>
        <h2 id="brand-kit-heading" className="font-semibold">Brand kit</h2>
        <p className="text-sm text-muted">
          The few decisions every surface reuses: the site, posts, decks and launch copy all take their look and voice from here.
          {brandKitDecided(kit) ? "" : " Nothing is decided yet, so agents fall back to the defaults below."}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
        <div className="space-y-4">
          <label className="block">
            <span className="label">Tagline</span>
            <input className="input" value={kit.tagline} maxLength={160} onChange={(e) => patch({ tagline: e.target.value })} placeholder="One line that says what you do" />
          </label>

          <fieldset>
            <legend className="label">Accent</legend>
            <div className="flex flex-wrap gap-2">
              {SITE_ACCENTS.map((accent) => (
                <label key={accent} className="flex cursor-pointer items-center gap-2 border border-line px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                  <input type="radio" name="accent" value={accent} checked={kit.accent === accent} onChange={() => patch({ accent })} className="sr-only" />
                  <span aria-hidden className="inline-block h-4 w-4" style={{ background: BRAND_ACCENT_HEX[accent] }} />
                  <span className="capitalize">{accent}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3">
            <fieldset>
              <legend className="label">Type</legend>
              <div className="flex flex-col gap-1">
                {SITE_FONTS.map((font) => (
                  <label key={font} className="flex cursor-pointer items-center gap-2 border border-line px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft" style={{ fontFamily: BRAND_FONT_STACK[font] }}>
                    <input type="radio" name="font" value={font} checked={kit.font === font} onChange={() => patch({ font })} />
                    {FONT_LABEL[font]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Corners</legend>
              <div className="flex flex-col gap-1">
                {SITE_RADII.map((radius) => (
                  <label key={radius} className="flex cursor-pointer items-center gap-2 border border-line px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="radius" value={radius} checked={kit.radius === radius} onChange={() => patch({ radius })} />
                    {RADIUS_LABEL[radius]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Mark</legend>
              <div className="flex flex-col gap-1">
                {BRAND_MARKS.map((mark) => (
                  <label key={mark} className="flex cursor-pointer items-center gap-2 border border-line px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="mark" value={mark} checked={kit.mark === mark} onChange={() => patch({ mark })} />
                    {MARK_LABEL[mark]}
                  </label>
                ))}
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={kit.dark} onChange={(e) => patch({ dark: e.target.checked })} />
                  Dark site
                </label>
              </div>
            </fieldset>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="label">Tone (up to five words)</span>
              <input className="input" defaultValue={kit.voice.tone.join(", ")} onChange={(e) => patch({ voice: { ...kit.voice, tone: words(e.target.value) } })} placeholder="plain, warm, exact" />
            </label>
            <label className="block">
              <span className="label">Do (one per line)</span>
              <textarea className="input min-h-20" defaultValue={kit.voice.do.join("\n")} onChange={(e) => patch({ voice: { ...kit.voice, do: words(e.target.value) } })} placeholder="Name the number" />
            </label>
            <label className="block">
              <span className="label">Don&apos;t (one per line)</span>
              <textarea className="input min-h-20" defaultValue={kit.voice.dont.join("\n")} onChange={(e) => patch({ voice: { ...kit.voice, dont: words(e.target.value) } })} placeholder="Say &quot;leverage&quot;" />
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <span className="label">How the site will open</span>
          <BrandPreview kit={kit} name={name} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        {error ? <span role="alert" className="text-sm text-danger">{error}</span> : problem ? <span className="text-sm text-danger">{problem}</span> : null}
        {saved ? <span role="status" className="text-sm text-muted">Brand kit saved. New sites, posts and copy use it from now on.</span> : null}
        <button className="btn btn-primary" disabled={busy || problem !== null}>{busy ? "Saving…" : "Save brand kit"}</button>
      </div>
    </form>
  );
}
