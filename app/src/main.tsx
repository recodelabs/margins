import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { ThemeToggle } from "./ThemeToggle";
import { applyTheme, currentTheme, getStoredTheme } from "./theme";
import "./style.css";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

// Apply the user's saved choice; otherwise follow the system preference.
applyTheme(currentTheme());
darkQuery.addEventListener("change", (event) => {
  if (!getStoredTheme()) applyTheme(event.matches ? "dark" : "light");
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <ThemeToggle />
    </TooltipProvider>
  </StrictMode>,
);
