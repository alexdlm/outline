import env from "@server/env";
import Logger from "./Logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("in production", () => {
    beforeEach(() => {
      vi.spyOn(env, "isProduction", "get").mockReturnValue(true);
    });

    it("should redact an Authorization header", () => {
      const spy = vi
        .spyOn(Logger.output, "info")
        .mockReturnValue(Logger.output);

      Logger.info("http", "Network request", {
        url: "https://api.example.com",
        headers: {
          Authorization: "Bearer secret",
          Accept: "application/json",
        },
      });

      expect(spy).toHaveBeenCalledWith("Network request", {
        url: "https://api.example.com",
        headers: {
          Authorization: "[Filtered]",
          Accept: "application/json",
        },
        label: "http",
      });
    });

    it("should redact sensitive fields regardless of case", () => {
      const spy = vi
        .spyOn(Logger.output, "info")
        .mockReturnValue(Logger.output);

      Logger.info("http", "Tokens", {
        authorization: "Bearer secret",
        AccessToken: "a",
        refreshToken: "b",
        TOKEN: "c",
        name: "visible",
      });

      expect(spy).toHaveBeenCalledWith("Tokens", {
        authorization: "[Filtered]",
        AccessToken: "[Filtered]",
        refreshToken: "[Filtered]",
        TOKEN: "[Filtered]",
        name: "visible",
        label: "http",
      });
    });
  });

  it("should not redact outside production", () => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(false);
    const spy = vi.spyOn(Logger.output, "info").mockReturnValue(Logger.output);

    Logger.info("http", "Network request", {
      headers: { Authorization: "Bearer secret" },
    });

    expect(spy).toHaveBeenCalledWith("Network request", {
      headers: { Authorization: "Bearer secret" },
      label: "http",
    });
  });
});
