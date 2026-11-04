import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { images, scoped, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";

export const IMAGE_PURPOSES = ["picture", "logo"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** Everything about a picture except its bytes; the bytes are served as an image, never as JSON. */
export interface ImageView {
  id: string;
  runId: string | null;
  purpose: ImagePurpose;
  prompt: string;
  model: string;
  seed: number;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

function toView(r: typeof images.$inferSelect): ImageView {
  return { id: r.id, runId: r.runId, purpose: r.purpose as ImagePurpose, prompt: r.prompt, model: r.model, seed: r.seed, mimeType: r.mimeType, width: r.width, height: r.height, bytes: r.bytes, createdAt: r.createdAt.toISOString() };
}

/** The pictures a company keeps. Tenant-scoped on every read and write, like every other service here. */
export class ImageService {
  constructor(private readonly db: Db) {}

  async create(scope: TenantScope, input: { runId?: string | null; purpose: ImagePurpose; prompt: string; model: string; seed: number; mimeType: string; width: number; height: number; data: Buffer }): Promise<ImageView> {
    if (!scope.companyId) throw new Error("images belong to a company");
    const [row] = await this.db
      .insert(images)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        runId: input.runId ?? null,
        purpose: input.purpose,
        prompt: input.prompt,
        model: input.model,
        seed: input.seed,
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        bytes: input.data.byteLength,
        digest: createHash("sha256").update(input.data).digest("hex"),
        data: input.data.toString("base64"),
      })
      .returning();
    return toView(row!);
  }

  async list(scope: TenantScope, opts: { purpose?: ImagePurpose; limit?: number } = {}): Promise<ImageView[]> {
    const filters = [scoped(scope, images)];
    if (opts.purpose) filters.push(eq(images.purpose, opts.purpose));
    const rows = await this.db
      .select()
      .from(images)
      .where(and(...filters))
      .orderBy(desc(images.createdAt))
      .limit(opts.limit ?? 60);
    return rows.map(toView);
  }

  async bytes(scope: TenantScope, id: string): Promise<{ image: ImageView; data: Buffer } | null> {
    const rows = await this.db.select().from(images).where(scoped(scope, images, eq(images.id, id))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { image: toView(row), data: Buffer.from(row.data, "base64") };
  }
}
