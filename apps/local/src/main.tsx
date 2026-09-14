import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NatallyApp } from "./app";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Application root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <NatallyApp />
  </StrictMode>,
);
