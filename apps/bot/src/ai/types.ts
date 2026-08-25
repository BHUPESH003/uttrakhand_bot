/**
 * Wire types for the "Chat with us" AI handoff contract (v1.0-draft,
 * ai-handoff-contract.html at the repo root). Field names/shapes here must
 * match that document exactly — it's the spec the external AI team builds
 * against.
 */
import type { ApplicationStatus, Service } from "types";

export interface AiConverseRequest {
  contractVersion: "1.0";
  requestId: string;
  conversationId: string;
  channel: "whatsapp";
  timestamp: string;
  user: {
    waId: string;
    profileName: string;
    language: "en" | "hi";
  };
  whatsapp: {
    phoneNumberId: string;
    incomingMessageId: string;
    withinSessionWindow: boolean;
    windowExpiresAt: string;
  };
  message: {
    type: "text" | "button_reply" | "list_reply";
    text: string | null;
    replyId: string | null;
    replyTitle: string | null;
  };
  context: {
    entryPoint: "menu_chat_with_us";
    turnNumber: number;
    applicant: {
      name: string;
      lastService: Service;
      lastApplicationStatus: ApplicationStatus;
    } | null;
  };
}

export type AiMessageBlock =
  | { type: "text"; text: string }
  | { type: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | {
      type: "list";
      body: string;
      buttonText: string;
      sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[];
    }
  | { type: "cta_url"; body: string; buttonText: string; url: string; headerText?: string }
  | { type: "image"; imageUrl: string; caption?: string }
  | { type: "document"; documentUrl: string; filename?: string; caption?: string };

export type AiControlAction = "continue" | "return_to_menu" | "end_session";

export interface AiConverseResponse {
  contractVersion: string;
  requestId: string;
  conversationId: string;
  messages: AiMessageBlock[];
  control: { action: AiControlAction; reason?: string | null };
  meta?: { intent?: string; confidence?: number };
}
