import { z } from "zod";

/** One sampler at a time: providers such as Anthropic reject temperature + top-p. */
export const PhaseTuning = z
  .object({
    sampler: z
      .enum(["temperature", "top_p", "provider_default"])
      .default("temperature"),
    temperature: z.number().min(0).max(1).default(0.3),
    topP: z.number().min(0.01).max(1).default(1),
    maxTokens: z.number().int().min(128).max(16384).default(4000),
  })
  .strict();
export const AgentSkill = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    name: z.string().trim().min(1).max(100),
    instructions: z.string().trim().min(1).max(4000),
    enabled: z.boolean().default(true),
  })
  .strict();
export type AgentSkill = z.infer<typeof AgentSkill>;
export const OverclockConfig = z
  .object({
    planning: PhaseTuning.default({
      sampler: "temperature",
      temperature: 0.2,
      topP: 1,
      maxTokens: 1500,
    }),
    acting: PhaseTuning.default({
      sampler: "temperature",
      temperature: 0.3,
      topP: 1,
      maxTokens: 4000,
    }),
    review: PhaseTuning.default({
      sampler: "temperature",
      temperature: 0,
      topP: 1,
      maxTokens: 800,
    }),
    memoryLimit: z.number().int().min(0).max(30).default(10),
    memoryMaxChars: z.number().int().min(0).max(12000).default(5000),
    conversationLimit: z.number().int().min(0).max(60).default(30),
    toolOutputMaxChars: z.number().int().min(1000).max(24000).default(24000),
    skills: z.array(AgentSkill).max(8).default([]),
  })
  .strict()
  .refine(
    (v) => new Set(v.skills.map((s) => s.id)).size === v.skills.length,
    "Skill ids must be unique",
  );
export type OverclockConfig = z.infer<typeof OverclockConfig>;
export const OVERCLOCK_DEFAULTS = OverclockConfig.parse({});

/** Invalid stored config fails closed instead of quietly pretending a custom setting took effect. */
export function effectiveOverclock(
  enabled: boolean,
  config: Record<string, unknown>,
) {
  return enabled
    ? OverclockConfig.parse(config.overclock ?? {})
    : OverclockConfig.parse({});
}
export function phaseRequest(phase: z.infer<typeof PhaseTuning>) {
  return {
    maxTokens: phase.maxTokens,
    ...(phase.sampler === "temperature"
      ? { temperature: phase.temperature }
      : phase.sampler === "top_p"
        ? { topP: phase.topP }
        : {}),
  };
}
export function skillContext(config: OverclockConfig) {
  return config.skills
    .filter((s) => s.enabled)
    .map((s) => `## Skill: ${s.name} (${s.id})\n${s.instructions}`)
    .join("\n\n");
}
