/**
 * ⚠️ PLACEHOLDER — PASTE FTGF'S REGISTERED 10DLC OPT-IN WORDING HERE ⚠️
 *
 * The SMS consent checkbox (profile page, and "Your details" on the RSVP
 * form) shows this text, and the exact text shown is stored with each
 * consent (profiles.sms_consent_text). It has to match, word for word, the
 * opt-in language registered for the Twilio 10DLC campaign.
 *
 * When you paste the real wording, also set SMS_CONSENT_IS_PLACEHOLDER to
 * false. Until then the checkbox is shown to admins only (so the test text
 * in Setup can be tried), and nobody else can consent against wording that
 * isn't the registered one.
 */
export const SMS_CONSENT_TEXT =
  "[PLACEHOLDER: registered 10DLC opt-in wording goes here.] I agree to receive text messages from Fishing the Good Fight. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.";

export const SMS_CONSENT_IS_PLACEHOLDER = true;
