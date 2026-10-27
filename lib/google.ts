import { google } from "googleapis";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
];

export function googleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    throw new Error("Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o APP_URL.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, `${appUrl}/api/google/callback`);
}

export function createGoogleAuthorizationUrl(state: string) {
  return googleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

function encodeMimeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendGmailMessage(input: {
  accessToken?: string;
  refreshToken: string;
  to: string;
  subject: string;
  body: string;
  senderName?: string;
  senderEmail?: string;
}) {
  const auth = googleOAuthClient();
  auth.setCredentials({ access_token: input.accessToken, refresh_token: input.refreshToken });
  const gmail = google.gmail({ version: "v1", auth });
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (input.senderEmail) {
    const from = input.senderName
      ? `${encodeMimeHeader(input.senderName)} <${input.senderEmail}>`
      : input.senderEmail;
    headers.unshift(`From: ${from}`);
  }
  const raw = `${headers.join("\r\n")}\r\n\r\n${Buffer.from(input.body, "utf8").toString("base64")}`;
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url") },
  });
  if (!response.data.id || !response.data.threadId) {
    throw new Error("Gmail no devolvió los identificadores del mensaje y del hilo.");
  }
  return { messageId: response.data.id, threadId: response.data.threadId };
}

export async function findReplyInThread(input: {
  accessToken?: string;
  refreshToken: string;
  threadId: string;
  sentMessageId: string;
  accountEmail: string;
  sentAt: Date;
}) {
  const auth = googleOAuthClient();
  auth.setCredentials({ access_token: input.accessToken, refresh_token: input.refreshToken });
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.threads.get({
    userId: "me",
    id: input.threadId,
    format: "metadata",
    metadataHeaders: ["From", "Date", "In-Reply-To", "References"],
  });
  const messages = response.data.messages || [];
  for (const message of messages) {
    if (!message.id || message.id === input.sentMessageId) continue;
    const timestamp = Number(message.internalDate || 0);
    if (timestamp && timestamp <= input.sentAt.getTime()) continue;
    const headers = new Map((message.payload?.headers || []).map((header) => [header.name?.toLowerCase(), header.value || ""]));
    const from = headers.get("from") || "";
    if (from.toLowerCase().includes(input.accountEmail.toLowerCase())) continue;
    return { messageId: message.id, from, receivedAt: timestamp ? new Date(timestamp) : new Date() };
  }
  return null;
}

export function renderMessage(template: string, values: Record<string, unknown>) {
  return template.replace(/{{\s*([\wÀ-ÿ-]+)\s*}}/g, (_match, key: string) => {
    const actual = Object.keys(values).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return actual ? String(values[actual] ?? "") : "";
  });
}
