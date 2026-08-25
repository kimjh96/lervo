const keys = new Set(["destinationId", "projectId", "deliveryId", "reviewGrant"]);

export function parseControlCoordinates(fragmentValue) {
  const fragment = new URLSearchParams(fragmentValue);
  const result = {
    destinationId: fragment.get("destinationId"),
    projectId: fragment.get("projectId"),
    deliveryId: fragment.get("deliveryId"),
    reviewGrant: fragment.get("reviewGrant"),
  };
  if (
    fragment.size !== 4 ||
    [...fragment.keys()].some((key) => !keys.has(key)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(result.destinationId ?? "") ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(result.projectId ?? "") ||
    !/^rcd_[a-f0-9]{64}$/.test(result.deliveryId ?? "") ||
    !/^hcrg_[1-9][0-9]{9}_[a-f0-9]{64}$/.test(result.reviewGrant ?? "")
  )
    return null;
  return result;
}

export function readControlCoordinates() {
  const result = parseControlCoordinates(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  return result;
}
