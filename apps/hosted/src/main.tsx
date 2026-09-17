import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HostedApp } from "./app";

const container = document.getElementById("root");
if (!container) throw new Error("Application root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <HostedApp />
  </StrictMode>,
);
