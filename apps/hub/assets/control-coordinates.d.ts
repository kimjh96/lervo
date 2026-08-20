export interface ControlCoordinates {
  destinationId: string;
  projectId: string;
  deliveryId: string;
  reviewGrant: string;
}

export function parseControlCoordinates(fragmentValue: string): ControlCoordinates | null;
export function readControlCoordinates(): ControlCoordinates | null;
