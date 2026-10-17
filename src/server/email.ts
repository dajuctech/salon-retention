// Transactional email (staff invitations, sign-in codes). EMAIL_TRANSPORT=console logs instead of
// sending and is refused in production unless set explicitly, so codes never silently vanish.

type Email = { to: string; subject: string; text: string };

export async function sendEmail(email: Email): Promise<void> {
  const transport = process.env.EMAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "resend" : "console");

  if (transport === "console") {
    // Development only: may contain a sign-in code or invite link.
    console.info(`\n[email] to=${email.to}\nsubject: ${email.subject}\n${email.text}\n`);
    return;
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Email is not configured (RESEND_API_KEY / EMAIL_FROM)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: email.to, subject: email.subject, text: email.text }),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}`);
}
