function reviewEndpoint(coordinates) {
  const url = new URL(`/v1/control/projects/${encodeURIComponent(coordinates.projectId)}/commands/${encodeURIComponent(coordinates.deliveryId)}`, location.origin);
  url.searchParams.set("destinationId", coordinates.destinationId);
  return url;
}

function approvalEndpoint(review) {
  const url = new URL(`/v1/policy/projects/${encodeURIComponent(review.projectId)}/approvals`, location.origin);
  url.searchParams.set("destinationId", review.destinationId);
  url.searchParams.set("projectIdentityHash", review.projectIdentityHash);
  return url;
}

async function readResponse(response, operation) {
  if (response.ok) return response.json();
  if (response.status === 401) throw new Error("토큰을 확인할 수 없습니다.");
  if (response.status === 403) {
    throw new Error(operation === "review"
      ? "이 대화 참여자와 토큰의 Hub 사용자가 다르거나 조회 권한이 없습니다."
      : "이 토큰에는 승인 권한이 없습니다.");
  }
  if (response.status === 404) throw new Error("검토할 command를 찾을 수 없습니다.");
  throw new Error("Hub가 요청을 처리하지 못했습니다.");
}

export function createControlApi({ coordinates, token }) {
  return {
    async loadReview() {
      const response = await fetch(reviewEndpoint(coordinates), {
        cache: "no-store",
        credentials: "omit",
        headers: {
          authorization: `Bearer ${token}`,
          "x-lervo-control-review": coordinates.reviewGrant,
        },
      });
      return readResponse(response, "review");
    },

    async approve(review, option) {
      const response = await fetch(approvalEndpoint(review), {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: review.delivery.commandId,
          capability: option.capability,
          repositoryPaths: option.repositoryPaths,
          expiresAt: review.approval.maximumExpiresAt,
        }),
      });
      return readResponse(response, "approval");
    },
  };
}
