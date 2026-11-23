import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../src/ui/base.css";
import "../src/ui/motion.css";
import { Catalog } from "./Catalog";

const container = document.getElementById("root");
if (container === null) throw new Error("catalog/index.html has no #root element.");
document.documentElement.dataset.material = "opaque";
document.documentElement.dataset.theme = "light";

createRoot(container).render(
  <StrictMode>
    <Catalog />
  </StrictMode>,
);
