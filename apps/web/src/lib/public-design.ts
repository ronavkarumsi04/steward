type PublicDesignEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  STEWARD_PUBLIC_DESIGN?: string;
  STEWARD_PUBLIC_PREVIEW?: string;
};

/** A preview is not a launch. Production always retains the incumbent public pages. */
export function quietPublicEnabled(env: PublicDesignEnvironment): boolean {
  return env.STEWARD_PUBLIC_DESIGN === "quiet" && env.VERCEL_ENV !== "production" && (
    env.NODE_ENV === "development" || env.VERCEL_ENV === "preview" || env.STEWARD_PUBLIC_PREVIEW === "true"
  );
}
