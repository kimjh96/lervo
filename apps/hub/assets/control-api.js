function reviewEndpoint(coordinates) {
  const url = new URL(
    `/v1/control/projects/${encodeURIComponent(coordinates.projectId)}/commands/${encodeURIComponent(coordinates.deliveryId)}`,
    location.origin,
  );
  url.searchParams.set("destinationId", coordinates.destinationId);
  return url;
}

function approvalEndpoint(review) {
  const url = new URL(
    `/v1/policy/projects/${encodeURIComponent(review.projectId)}/approvals`,
    location.origin,
  );
  url.searchParams.set("destinationId", review.destinationId);
  url.searchParams.set("projectIdentityHash", review.projectIdentityHash);
  return url;
}

async function readResponse(response, operation) {
  if (response.ok) return response.json();
  if (response.status === 401) throw new Error("The token could not be authenticated.");
  if (response.status === 403) {
    throw new Error(
      operation === "review"
        ? "The conversation participant does not match the Hub token principal, or the token lacks read access."
        : "This token does not have approval permission.",
    );
  }
  if (response.status === 404) throw new Error("The command to review was not found.");
  throw new Error("The Hub could not process the request.");
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
