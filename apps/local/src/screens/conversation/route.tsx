import { type ComponentType, use } from "react";
import { createConversationComposition } from "../../composition.js";
import { loadRuntimeConfig } from "../../config.js";
import type { RouteScreenProps } from "../../ui/router.js";
import { ConversationScreen } from "./index.js";

/**
 * Route adapter for the conversation screen (the `/` surface). The composition root
 * supplies production services; navigation callbacks route through the hash router.
 * Registered by the generated route registry (I.1); regenerating never edits this file.
 */

let composition: ReturnType<typeof createConversationComposition> | undefined;

function conversationComposition() {
  composition ??= createConversationComposition();
  return composition;
}

const ConversationRouteScreen: ComponentType<RouteScreenProps> = () => {
  const { sessionId, services } = use(conversationComposition());
  return (
    <ConversationScreen
      sessionId={sessionId}
      services={services}
      trialPolicy={loadRuntimeConfig().trial}
      onUnlock={() => {
        window.location.hash = "#/paywall";
      }}
      onEnterCode={() => {
        window.location.hash = "#/paywall";
      }}
      onOpenPlate={(plateId) => {
        window.location.hash = `#/atlas/${encodeURIComponent(plateId)}`;
      }}
    />
  );
};

export default ConversationRouteScreen;
