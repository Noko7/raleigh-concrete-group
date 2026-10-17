// Server-only SMS notifications. Never import from a client component.
//
// Provider is chosen with SMS_PROVIDER; if unset we default to "quo" when a
// QUO_API_KEY is present, otherwise "twilio".
//   Quo (OpenPhone):  QUO_API_KEY, QUO_FROM (E.164), optional QUO_USER_ID
//   Twilio:           TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   Custom:           SMS_API_URL, SMS_API_KEY, SMS_FROM  (POSTs { to, from, message })
// OWNER_PHONE receives the owner alerts ("my number").
//
// Every send is best-effort so an SMS outage can't break a submission or save.
// Failures log with an [sms] prefix.
//
// The code lives in ./notify/: send (providers, queue, recipients), templates
// (links and message builders), and the notifications by stage (lifecycle,
// reminders, payments). ./notify/format holds the internal text helpers and
// is not re-exported, apart from the public ChosenOption type.
export * from "./notify/send";
export type { ChosenOption } from "./notify/format";
export * from "./notify/templates";
export * from "./notify/lifecycle";
export * from "./notify/reminders";
export * from "./notify/payments";
