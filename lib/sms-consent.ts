/**
 * FTGF's SMS opt-in wording, for the Twilio 10DLC campaign ("Fishing the
 * Good Fight Event & Volunteer Texts").
 *
 * The SMS consent checkbox (profile page, and "Your details" on the RSVP
 * form) shows this text, and the exact text shown is stored with each
 * consent (profiles.sms_consent_text). It has to match, word for word, the
 * opt-in language in the campaign's Message Flow and in Section 4 of the
 * privacy policy. Change all three together, and only once the campaign
 * registration has been updated to the new wording.
 */
export const SMS_CONSENT_TEXT =
  "Yes, text me event reminders and volunteer updates from Fishing the Good Fight at the number above. Message frequency varies. Message and data rates may apply. Reply HELP for help, STOP to opt out. Consent isn't required to join, RSVP or volunteer.";

/** True while SMS_CONSENT_TEXT was a stand-in: the checkbox was then shown
 * to admins only. */
export const SMS_CONSENT_IS_PLACEHOLDER = false;

/** Linked from the public opt-in page (app/sms) and meant to match the
 * campaign registration. Null = not published yet, so not linked. */
export const PRIVACY_POLICY_URL: string | null =
  "https://docs.google.com/document/d/1QsC7tmAPIBN2_OFDSRP5bOJ-EYNNB3pZMdOnKKm2WKM/";
export const TERMS_URL: string | null = null;
