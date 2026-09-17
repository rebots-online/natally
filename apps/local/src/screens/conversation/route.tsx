import { type ComponentType, use, useSyncExternalStore } from "react";
import { createConversationComposition } from "../../composition.js";
import { loadRuntimeConfig } from "../../config.js";
import type { RouteScreenProps } from "../../ui/router.js";
import { FirstLight } from "../first-light/FirstLight.js";
import { ConversationScreen } from "./index.js";

/**
 * Route adapter for the conversation screen (the `/` surface). The composition root
 * supplies production services; navigation callbacks route through the hash router.
 * U.4/J1: until a Person exists the surface shows the first-light intake instead —
 * no chart is ever invented without real birth data.
 * Registered by the generated route registry (I.1); regenerating never edits this file.
 */

let composition: ReturnType<typeof createConversationComposition> | undefined;

function conversationComposition() {
  composition ??= createConversationComposition();
  return composition;
}

const ConversationRouteScreen: ComponentType<RouteScreenProps> = () => {
  const { sessionId, services, models, downloadModel, intake, gazetteer, createPerson } = use(
    conversationComposition(),
  );
  const model = useSyncExternalStore(
    (listener) => models.subscribe(listener),
    () => models.get(),
  );
  const intakeState = useSyncExternalStore(
    (listener) => intake.subscribe(listener),
    () => intake.get(),
  );

  if (intakeState.needed) {
    return (
      <FirstLight
        gazetteer={gazetteer}
        busy={intakeState.busy}
        error={intakeState.error}
        onCreate={(draft) => {
          void createPerson(draft);
        }}
      />
    );
  }

  return (
    <ConversationScreen
      sessionId={sessionId}
      services={services}
      trialPolicy={loadRuntimeConfig().trial}
      model={model.row}
      onDownloadModel={(modelId) => {
        void downloadModel(modelId);
      }}
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
