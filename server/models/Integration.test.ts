import type { IntegrationSettings } from "@shared/types";
import { IntegrationService, IntegrationType } from "@shared/types";
import {
  buildAdmin,
  buildGuestUser,
  buildIntegration,
  buildTeam,
} from "@server/test/factories";
import { Hook, PluginManager } from "@server/utils/PluginManager";

const account = { id: "account-1", name: "Acme", subdomain: "acme" };

const settings: IntegrationSettings<IntegrationType.Embed> = {
  url: "https://acme.codecks.io",
  codecks: { account },
  codecksMappings: [
    {
      projectId: "project-1",
      projectName: "Game",
      collectionId: "collection-1",
      defaultDeckId: null,
    },
  ],
};

describe("Integration", () => {
  describe("presentSettings", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function setup() {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const guest = await buildGuestUser({ teamId: team.id });
      const integration = await buildIntegration({
        teamId: team.id,
        userId: admin.id,
        service: IntegrationService.Codecks,
        type: IntegrationType.Embed,
        settings,
      });
      return { admin, guest, integration };
    }

    it("should present only the keys registered for the service", async () => {
      const { admin, integration } = await setup();
      vi.spyOn(PluginManager, "getHooks").mockReturnValue([
        {
          type: Hook.IntegrationSettings,
          value: { service: IntegrationService.Codecks, keys: ["codecks"] },
        },
        {
          type: Hook.IntegrationSettings,
          value: { service: IntegrationService.Linear, keys: ["url"] },
        },
      ]);

      const presented = integration.presentSettings(admin);

      expect(presented).toEqual({
        url: "https://acme.codecks.io",
        codecks: { account },
      });
      expect(presented).not.toHaveProperty("codecksMappings");
    });

    it("should not present unregistered keys when no plugin registers any", async () => {
      const { admin, integration } = await setup();
      vi.spyOn(PluginManager, "getHooks").mockReturnValue([]);

      const presented = integration.presentSettings(admin);

      expect(presented).toEqual({ url: "https://acme.codecks.io" });
      expect(presented).not.toHaveProperty("codecks");
      expect(presented).not.toHaveProperty("codecksMappings");
    });

    it("should omit registered keys for guests", async () => {
      const { guest, integration } = await setup();
      vi.spyOn(PluginManager, "getHooks").mockReturnValue([
        {
          type: Hook.IntegrationSettings,
          value: { service: IntegrationService.Codecks, keys: ["codecks"] },
        },
      ]);

      const presented = integration.presentSettings(guest);

      expect(presented).toEqual({ url: "https://acme.codecks.io" });
      expect(presented).not.toHaveProperty("codecks");
    });

    it("should present keys visible to guests", async () => {
      const { guest, integration } = await setup();
      vi.spyOn(PluginManager, "getHooks").mockReturnValue([
        {
          type: Hook.IntegrationSettings,
          value: {
            service: IntegrationService.Codecks,
            keys: ["codecks"],
            visibleToGuests: true,
          },
        },
      ]);

      const presented = integration.presentSettings(guest);

      expect(presented).toEqual({
        url: "https://acme.codecks.io",
        codecks: { account },
      });
      expect(presented).not.toHaveProperty("codecksMappings");
    });
  });
});
