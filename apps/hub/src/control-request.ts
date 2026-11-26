import { InvalidHubHttpRequestError } from "./request.js";

const PROJECT_ID = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const DELIVERY_ID = /^rcd_[a-f0-9]{64}$/u;
const DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export function matchHubControlRoute(pathname: string): {
  projectId: string;
  deliveryId: string;
} | null {
  const parts = pathname.split("/");
  if (
    parts.length !== 7 ||
    parts[0] !== "" ||
    parts[1] !== "v1" ||
    parts[2] !== "control" ||
    parts[3] !== "projects" ||
    parts[5] !== "commands"
  )
    return null;
  let projectId: string;
  let deliveryId: string;
  try {
    projectId = decodeURIComponent(parts[4]!);
    deliveryId = decodeURIComponent(parts[6]!);
  } catch (error) {
    throw new InvalidHubHttpRequestError({ cause: error });
  }
  if (!PROJECT_ID.test(projectId) || !DELIVERY_ID.test(deliveryId)) {
    throw new InvalidHubHttpRequestError();
  }
  return { projectId, deliveryId };
}

export function controlDestination(parameters: URLSearchParams): string {
  if ([...parameters.keys()].some((key) => key !== "destinationId")) {
    throw new InvalidHubHttpRequestError();
  }
  const values = parameters.getAll("destinationId");
  if (values.length !== 1 || !DESTINATION_ID.test(values[0]!)) {
    throw new InvalidHubHttpRequestError();
  }
  return values[0]!;
}
