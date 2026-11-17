/**
 * The global "Back to Main Menu" escape hatch — routed by the engine from
 * any state. Its own module (re-exported by definition.ts) so state modules
 * like commerce-demo/journeys.ts can use it without importing
 * definition.ts, which imports them.
 */
import type { FlowContext } from "./types";

export const BACK_TO_MENU_ID = "back_to_menu";

/** Every state other than WELCOME/OPTED_OUT ends its menu with this — one button, routed by the engine's global back-to-menu rule. Also used by flow/aiChat.ts, which appends the same escape hatch to every AI turn (see the contract's "guarantee the escape hatch ourselves" recommendation). */
export function backToMenuButton(ctx: FlowContext) {
  return {
    kind: "sendReplyButtons" as const,
    body: ctx.t("back_to_menu"),
    buttons: [{ id: BACK_TO_MENU_ID, title: ctx.t("back_to_menu") }],
  };
}
