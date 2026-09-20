import type { IntegrationDefinition } from "./framework.js";
import { genericRestDefinition, googleDefinition, hubspotDefinition, neonDefinition, notionDefinition, stripeDefinition, supabaseDefinition } from "./providers/business.js";
import { renderDefinition, vercelDefinition } from "./providers/deploy.js";
import { postmarkDefinition, resendDefinition, sendgridDefinition, smtpDefinition } from "./providers/email.js";
import { githubDefinition } from "./providers/github.js";
import { discordDefinition, linkedinDefinition, slackDefinition, twilioDefinition, xDefinition } from "./providers/messaging.js";

export const INTEGRATIONS: IntegrationDefinition[] = [
  githubDefinition,
  vercelDefinition,
  renderDefinition,
  neonDefinition,
  supabaseDefinition,
  resendDefinition,
  postmarkDefinition,
  sendgridDefinition,
  smtpDefinition,
  googleDefinition,
  slackDefinition,
  discordDefinition,
  twilioDefinition,
  xDefinition,
  linkedinDefinition,
  stripeDefinition,
  hubspotDefinition,
  notionDefinition,
  genericRestDefinition,
];

export const integrationMap = new Map(INTEGRATIONS.map((i) => [i.id, i]));

/** Public (non-secret) view for the UI. */
export function publicIntegration(def: IntegrationDefinition) {
  return { id: def.id, name: def.name, category: def.category, authKind: def.authKind, oauth: Boolean(def.oauth), fields: def.fields ?? [], docsUrl: def.docsUrl, actions: def.actions, status: def.status };
}
