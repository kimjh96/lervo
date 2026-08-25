import { createControlApi } from "./control-api.js";
import { readControlCoordinates } from "./control-coordinates.js";
import { renderControlReview } from "./control-render.js";

const coordinates = readControlCoordinates();
const form = document.querySelector("#auth-form");
const tokenInput = document.querySelector("#token");
const disconnect = document.querySelector("#disconnect");
const status = document.querySelector("#status");
const reviewPanel = document.querySelector("#review");
let api = null;
let currentReview = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function approve(option, button) {
  if (api === null || currentReview?.approval.maximumExpiresAt === null) return;
  button.disabled = true;
  setStatus("Creating the approval record.");
  try {
    await api.approve(currentReview, option);
    currentReview = await api.loadReview();
    renderControlReview(currentReview, approve);
    setStatus(
      "The signed approval was created. The Node will reevaluate the command after synchronizing policy.",
    );
  } catch (error) {
    button.disabled = false;
    setStatus(error instanceof Error ? error.message : "Approval failed.", true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (coordinates === null) {
    setStatus("The review URL is missing or invalid. Request a new URL in the conversation.", true);
    return;
  }
  api = createControlApi({ coordinates, token: tokenInput.value });
  tokenInput.value = "";
  setStatus("Checking command status with the Hub.");
  try {
    currentReview = await api.loadReview();
    renderControlReview(currentReview, approve);
    disconnect.hidden = false;
    setStatus("Authenticated. Review the execution details and approval scopes below.");
  } catch (error) {
    api = null;
    currentReview = null;
    reviewPanel.hidden = true;
    setStatus(error instanceof Error ? error.message : "Authentication failed.", true);
  }
});

disconnect.addEventListener("click", () => {
  api = null;
  currentReview = null;
  reviewPanel.hidden = true;
  disconnect.hidden = true;
  setStatus("Disconnected. The token was removed from this tab's memory.");
});

if (coordinates === null) {
  tokenInput.disabled = true;
  form.querySelector('button[type="submit"]').disabled = true;
  setStatus("The review URL is missing or invalid. Request a new URL in the conversation.", true);
}
