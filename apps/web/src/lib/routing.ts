export const ROUTING_PURPOSES = ["default", "planning", "coding", "research", "verification", "chat", "cheap", "embedding"] as const;
export type RoutingPurpose = (typeof ROUTING_PURPOSES)[number];
