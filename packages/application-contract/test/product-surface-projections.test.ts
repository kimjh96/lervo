import type {
  ProductActivityPageV1,
  ProductActivitySubscriptionHintV1,
  ProductDeliberationViewV1,
  ProductSteeringCommandV1,
  ProductUnifiedSearchResultV1,
  SurfaceObservabilityReportV1,
} from "../src/index.js";
import { describe, expectTypeOf, it } from "vitest";

describe("product surface projection exports", () => {
  it("exposes provider-neutral projection contracts to product hosts", () => {
    expectTypeOf<ProductActivityPageV1["kind"]>().toEqualTypeOf<"product_surface.activity">();
    expectTypeOf<ProductUnifiedSearchResultV1["kind"]>().toEqualTypeOf<"product_surface.search">();
    expectTypeOf<
      SurfaceObservabilityReportV1["kind"]
    >().toEqualTypeOf<"product_surface.observability">();
    expectTypeOf<
      ProductDeliberationViewV1["kind"]
    >().toEqualTypeOf<"product_surface.deliberation">();
    expectTypeOf<
      ProductSteeringCommandV1["kind"]
    >().toEqualTypeOf<"product_surface.steering_command">();
    expectTypeOf<
      ProductActivitySubscriptionHintV1["kind"]
    >().toEqualTypeOf<"product_surface.activity_subscription_hint">();
  });
});
