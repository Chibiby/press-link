/**
 * The roster form's rules, in one place a test can reach.
 *
 * `admin_create_judge` and `admin_update_judge` (migration 0029) check the same
 * things, and neither is enforcement of the other: the RPC's checks are what stop
 * a caller that skips this module, and this module is what an admin actually
 * reads. A Postgres exception cannot say "Middle name is optional" next to the
 * field it belongs to, and nothing in this repo renders a component under test —
 * so the sentences live here, beside their own `.test.ts`, following
 * `lib/schools/validate-new-school.ts`.
 */

/** The raw, untrusted fields the add/edit judge dialog submits. */
export interface JudgeInput {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  affiliation: string;
}

/**
 * A trimmed input. Every optional field is `null` rather than `""`, because
 * `judges` distinguishes the two: a judge with no email on file cannot be given a
 * login, and an empty string would read as an address nobody can send to.
 */
export interface ValidatedJudge {
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string | null;
  affiliation: string | null;
}

export type JudgeValidationResult = { error: string } | { judge: ValidatedJudge };

/**
 * Deliberately loose: one `@`, something either side, and a dot in the domain.
 * The address is not used to send anything — a provisioned judge's account is
 * created with `email_confirm: true` and no mail leaves the system — so the only
 * failure a stricter pattern could prevent is one nobody would ever see, while a
 * stricter pattern would certainly refuse somebody's real address.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `null` for a blank field, so the column records "not on file" rather than "". */
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Trims and checks a judge form submission, or explains the first problem found.
 *
 * The order follows the fields down the form, so the first complaint an admin
 * reads is also the first field their eye reaches.
 */
export function validateJudgeInput(input: JudgeInput): JudgeValidationResult {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = optional(input.email)?.toLowerCase() ?? null;

  if (!firstName) return { error: "First name is required." };
  if (!lastName) return { error: "Last name is required." };
  if (email !== null && !EMAIL_PATTERN.test(email)) {
    return { error: "That does not look like an email address." };
  }

  return {
    judge: {
      firstName,
      lastName,
      middleName: optional(input.middleName),
      email,
      affiliation: optional(input.affiliation),
    },
  };
}

/**
 * Supabase's own floor is six characters. Eight is asked for here because an
 * admin types this once and reads it out to a judge who will use it on a phone
 * at a contest venue, and the account it opens can see every contestant's code
 * in the events that judge sits on.
 */
export const MIN_JUDGE_PASSWORD = 8;

/** The password an admin sets when provisioning a judge's login. */
export function validateJudgePassword(password: string): { error: string } | { password: string } {
  // Not trimmed: a leading or trailing space is part of a password, and silently
  // removing it here would open an account nobody can sign in to.
  if (password.length < MIN_JUDGE_PASSWORD) {
    return { error: `Password must be at least ${MIN_JUDGE_PASSWORD} characters.` };
  }
  return { password };
}
