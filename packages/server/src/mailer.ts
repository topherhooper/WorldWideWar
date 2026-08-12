import { Resend } from 'resend';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class LogMailer implements Mailer {
  sent: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    console.log(`[mail] to=${mail.to} subject=${mail.subject}`);
  }
}

/** Email failure must never fail the request that triggered it. */
export function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(mail: Mail): Promise<void> {
      try {
        const { error } = await resend.emails.send({
          from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        });
        if (error) console.error(`[mail] resend error: ${error.message}`);
      } catch (err) {
        console.error(`[mail] resend threw:`, err);
      }
    },
  };
}
