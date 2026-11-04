"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { ImageView } from "@/lib/types";
import { Card, Empty, Ago } from "./ui";

export function imageSrc(companyId: string, imageId: string) {
  return `/api/v1/companies/${companyId}/images/${imageId}`;
}

const ASPECTS = [
  ["square", "Square 1024×1024"],
  ["wide", "Wide 1344×768"],
  ["tall", "Tall 768×1344"],
] as const;

/**
 * The pictures a company keeps, and a way to ask for one. Agents make most of them (`image.generate`); the founder
 * can ask directly for a post image or a logo candidate, with the company's own NVIDIA key.
 */
export function PicturesPanel({ companyId, pictures, onLoaded }: { companyId: string; pictures: ImageView[] | null; onLoaded: (p: ImageView[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [purpose, setPurpose] = useState<"picture" | "logo">("picture");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number][0]>("square");

  useEffect(() => {
    if (pictures) return;
    browserApi
      .get<{ images: ImageView[] }>(`/companies/${companyId}/images`)
      .then((r) => onLoaded(r.images))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load pictures."));
  }, [companyId, pictures, onLoaded]);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await browserApi.post<{ image: ImageView }>(`/companies/${companyId}/images`, { prompt, purpose, aspect });
      onLoaded([r.image, ...(pictures ?? [])]);
      setPrompt("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The picture could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Pictures" className="nb-left-blue">
      <form onSubmit={make} className="mb-4 space-y-2 card-inset nb-left-blue">
        <label className="block text-sm font-medium" htmlFor="picture-prompt">Ask for a picture</label>
        <textarea id="picture-prompt" className="input min-h-20 w-full" required minLength={8} maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Launch post hero: a carbon work order on a dark desk, blue accent, bold type, no text" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name="purpose" checked={purpose === "picture"} onChange={() => setPurpose("picture")} /> Picture
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="purpose" checked={purpose === "logo"} onChange={() => setPurpose("logo")} /> Logo candidate
          </label>
          <select aria-label="Shape" className="input" value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
            {ASPECTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy || prompt.trim().length < 8}>{busy ? "Making…" : "Make picture"}</button>
        </div>
        <p className="text-xs text-muted">Made with the company’s NVIDIA key (FLUX.1 schnell), about five seconds. Logo candidates come out best as a flat, simple mark on a plain background.</p>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </form>
      {pictures === null && !error ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !pictures || pictures.length === 0 ? (
        <Empty>No pictures yet. Agents make post images and logo candidates here with image.generate; you can ask for one above.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pictures.map((p) => (
            <li key={p.id} className="nb-panel-flat flex flex-col">
              <a href={imageSrc(companyId, p.id)} target="_blank" rel="noreferrer" className="block bg-paper-2">
                <img src={imageSrc(companyId, p.id)} alt={p.prompt} width={p.width} height={p.height} loading="lazy" className="aspect-square w-full object-contain" />
              </a>
              <div className="space-y-1 p-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="pill text-muted">{p.purpose === "logo" ? "Logo candidate" : "Picture"}</span><span className="mono text-muted">{p.width}×{p.height} · {Math.round(p.bytes / 1024)} kB</span></div>
                <p className="line-clamp-3 text-muted">{p.prompt}</p>
                <p className="text-muted"><Ago iso={p.createdAt} /> · seed {p.seed}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
