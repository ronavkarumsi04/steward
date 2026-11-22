import { z } from "zod";

export const WaitlistJoin = z.object({
  email: z.string().trim().pipe(z.email()),
  name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type WaitlistJoin = z.infer<typeof WaitlistJoin>;
