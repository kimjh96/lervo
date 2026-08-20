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
  setStatus("승인 원본을 만들고 있습니다.");
  try {
    await api.approve(currentReview, option);
    currentReview = await api.loadReview();
    renderControlReview(currentReview, approve);
    setStatus("서명된 승인이 생성되었습니다. Node가 정책을 다시 동기화하면 command를 재평가합니다.");
  } catch (error) {
    button.disabled = false;
    setStatus(error instanceof Error ? error.message : "승인에 실패했습니다.", true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (coordinates === null) {
    setStatus("검토 주소가 없거나 형식이 올바르지 않습니다. 대화에서 새 주소를 받아 주세요.", true);
    return;
  }
  api = createControlApi({ coordinates, token: tokenInput.value });
  tokenInput.value = "";
  setStatus("Hub에서 command 상태를 확인하고 있습니다.");
  try {
    currentReview = await api.loadReview();
    renderControlReview(currentReview, approve);
    disconnect.hidden = false;
    setStatus("인증되었습니다. 아래 실행 정보와 승인 범위를 확인하세요.");
  } catch (error) {
    api = null;
    currentReview = null;
    reviewPanel.hidden = true;
    setStatus(error instanceof Error ? error.message : "인증에 실패했습니다.", true);
  }
});

disconnect.addEventListener("click", () => {
  api = null;
  currentReview = null;
  reviewPanel.hidden = true;
  disconnect.hidden = true;
  setStatus("연결을 해제했습니다. 토큰은 현재 탭 메모리에서 제거되었습니다.");
});

if (coordinates === null) {
  tokenInput.disabled = true;
  form.querySelector('button[type="submit"]').disabled = true;
  setStatus("검토 주소가 없거나 형식이 올바르지 않습니다. 대화에서 새 주소를 받아 주세요.", true);
}
