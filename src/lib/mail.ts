import nodemailer from "nodemailer";
import { env } from "@/lib/env";

// Outbound mail goes through the store's existing SMTP relay (Gate 0, B2).

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

export function inviteEmail(name: string, url: string): { subject: string; text: string } {
  return {
    subject: "Your RF Supplements Ops CRM account",
    text: [
      `Hi ${name},`,
      "",
      "An account has been created for you on the RF Supplements Ops CRM.",
      "Use the link below to set your password and enrol your authenticator app.",
      "It can only be used once and expires in 24 hours.",
      "",
      url,
      "",
      "If you were not expecting this, ignore it and tell Darrin.",
    ].join("\n"),
  };
}
