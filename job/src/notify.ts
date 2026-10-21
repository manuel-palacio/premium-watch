import { Resend } from 'resend';

export interface AlertMessage {
  subject: string;
  text: string;
  html: string;
}

export interface Notifier {
  send(msg: AlertMessage): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  sent: AlertMessage[] = [];
  async send(msg: AlertMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`[alert] ${msg.subject}\n${msg.text}`);
  }
}

export class ResendNotifier implements Notifier {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly to: string[];
  constructor(apiKey: string, from: string, to: string[]) {
    this.resend = new Resend(apiKey);
    this.from = from;
    this.to = to;
  }
  async send(msg: AlertMessage): Promise<void> {
    const { error } = await this.resend.emails.send({ from: this.from, to: this.to, subject: msg.subject, text: msg.text, html: msg.html });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  }
}

/** Resend when RESEND_API_KEY and ALERT_TO are set, otherwise log to the console. */
export function notifierFromEnv(env: NodeJS.ProcessEnv = process.env): Notifier {
  if (env.RESEND_API_KEY && env.ALERT_TO) {
    return new ResendNotifier(env.RESEND_API_KEY, env.ALERT_FROM ?? 'Premium Watch <onboarding@resend.dev>', env.ALERT_TO.split(',').map((s) => s.trim()));
  }
  return new ConsoleNotifier();
}
