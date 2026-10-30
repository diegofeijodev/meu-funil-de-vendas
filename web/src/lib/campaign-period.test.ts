import { describe, expect, it } from "vitest";
import { campaignPeriod } from "@/lib/campaign-period";

describe("período da campanha (Brasília)", () => {
  it("aberto, último dia ou encerrado", () => {
    expect(campaignPeriod("2026-11-27", "2026-10-30")).toBe("open");
    expect(campaignPeriod("2026-10-30", "2026-10-30")).toBe("last_day");
    expect(campaignPeriod("2026-10-29T00:00:00.000Z", "2026-10-30")).toBe("ended");
    expect(campaignPeriod(null, "2026-10-30")).toBe("open");
  });
});
