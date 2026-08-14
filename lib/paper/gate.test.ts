import { describe, expect, it } from "vitest";

import { DECLINE_REASON_LABELS, paperGateState } from "./gate";

describe("paperGateState", () => {
  it("asks a school that has not answered yet", () => {
    expect(
      paperGateState({
        participation: "undecided",
        declineReason: null,
        savedLanguageCount: 0,
      })
    ).toEqual({ askAgain: true, paperFormEnabled: true });
  });

  it("keeps asking a Yes school until it saves a language", () => {
    expect(
      paperGateState({ participation: "yes", declineReason: null, savedLanguageCount: 0 })
    ).toEqual({ askAgain: true, paperFormEnabled: true });
  });

  it("stops asking once a Yes school has saved one language", () => {
    expect(
      paperGateState({ participation: "yes", declineReason: null, savedLanguageCount: 1 })
    ).toEqual({ askAgain: false, paperFormEnabled: true });
  });

  it("keeps asking a school that said it would submit later", () => {
    expect(
      paperGateState({
        participation: "no",
        declineReason: "submit_later",
        savedLanguageCount: 0,
      })
    ).toEqual({ askAgain: true, paperFormEnabled: true });
  });

  it("leaves a school with no paper yet alone, but able to fill it in", () => {
    expect(
      paperGateState({
        participation: "no",
        declineReason: "no_paper_yet",
        savedLanguageCount: 0,
      })
    ).toEqual({ askAgain: false, paperFormEnabled: true });
  });

  it("disables the form for a school that will not submit", () => {
    expect(
      paperGateState({
        participation: "no",
        declineReason: "will_not_submit",
        savedLanguageCount: 0,
      })
    ).toEqual({ askAgain: false, paperFormEnabled: false });
  });

  it("disables the form for an other reason too", () => {
    expect(
      paperGateState({ participation: "no", declineReason: "other", savedLanguageCount: 0 })
    ).toEqual({ askAgain: false, paperFormEnabled: false });
  });

  it("re-asks a No school whose reason went missing rather than locking it out", () => {
    expect(
      paperGateState({ participation: "no", declineReason: null, savedLanguageCount: 0 })
    ).toEqual({ askAgain: true, paperFormEnabled: true });
  });

  it("labels every reason", () => {
    expect(Object.keys(DECLINE_REASON_LABELS)).toEqual([
      "submit_later",
      "no_paper_yet",
      "will_not_submit",
      "other",
    ]);
  });
});
