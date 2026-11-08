import { CodecksDisplayDefaults, readCodecksDisplay } from "./display";

describe("readCodecksDisplay", () => {
  it.each([undefined, null, {}, { codecks: {} }, { codecks: { display: 5 } }])(
    "uses the defaults for %j",
    (settings) => {
      expect(readCodecksDisplay(settings)).toEqual(CodecksDisplayDefaults);
    }
  );

  it("reads the display options", () => {
    expect(
      readCodecksDisplay({
        codecks: { display: { effort: false, assignee: true } },
      })
    ).toEqual({ effort: false, assignee: true });
  });

  it("falls back for options that are missing or not booleans", () => {
    expect(
      readCodecksDisplay({ codecks: { display: { effort: "no" } } })
    ).toEqual({ effort: true, assignee: true });
    expect(
      readCodecksDisplay({ codecks: { display: { assignee: false } } })
    ).toEqual({ effort: true, assignee: false });
  });
});
