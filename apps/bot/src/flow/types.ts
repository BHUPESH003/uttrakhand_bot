/**
 * The contract every flow state is built from. The engine (flow/engine.ts)
 * only knows these shapes — it has no idea what "MAIN_MENU" or
 * "APPLY_CHOOSE" mean. All menu-specific behaviour lives in
 * flow/definition.ts as data conforming to FlowState.
 */
import type { ReplyButton, ListSection } from "../whatsapp/client";
import type { IncomingMessage } from "../whatsapp/types";
import type { Session } from "../session/store";
import type { CopyKey } from "./copy";

/**
 * A state's onEnter returns *descriptions* of what to send, not direct
 * WhatsAppClient calls — that's what makes states testable without a live
 * client, and keeps every payload shape decided in one place (the engine).
 */
export type OutgoingAction =
  | { kind: "sendText"; text: string }
  | { kind: "sendImage"; imageUrl: string; caption?: string }
  | { kind: "sendDocument"; documentUrl: string; filename?: string; caption?: string }
  | { kind: "sendReplyButtons"; body: string; buttons: ReplyButton[] }
  | {
      kind: "sendList";
      body: string;
      buttonText: string;
      sections: ListSection[];
    }
  | {
      kind: "sendCtaUrl";
      body: string;
      buttonText: string;
      url: string;
      headerText?: string;
    };

export interface FlowContext {
  session: Session;
  message: IncomingMessage;
  /** Resolves copy for session.data.lang, substituting any {{placeholders}} in `vars`. */
  t: (key: CopyKey, vars?: Record<string, string>) => string;
}

export interface FlowState {
  key: string;
  /**
   * What to send when the engine transitions into this state. Async
   * because some states (e.g. TRACK_RESULT) need a DB lookup to know what
   * to say — most states just return a resolved array.
   */
  onEnter(ctx: FlowContext): Promise<OutgoingAction[]> | OutgoingAction[];
  /**
   * Reads ctx.message (and may mutate ctx.session.data) to decide where to
   * go next. Return null when the input isn't understood — the engine then
   * sends the fallback copy and re-enters this same state.
   */
  handleInput(ctx: FlowContext): Promise<string | null> | (string | null);
}
