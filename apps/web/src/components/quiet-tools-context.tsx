import type { ReactNode } from "react";

/** Data-dependent context belongs below the stable Quiet route heading. */
export function QuietToolsContext({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return <div className="panel-heading">
    <div className="min-w-0">
      {title && <h2>{title}</h2>}
      {description && <p>{description}</p>}
    </div>
    {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
  </div>;
}
