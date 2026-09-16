// sendOwnerReport.ts — builds and sends the owner performance report email.
// Follows the same lazy-Resend-singleton, never-throws pattern as
// skedai/conversationAlert.ts. Report sending is entirely opt-in per tenant
// (report_frequency defaults to 'off') — this module only runs when the
// caller has already confirmed a tenant is due, or on an explicit manual send.
import { Resend } from 'resend';
import type { OwnerReportStats } from './computeReportStats.js';

const FROM_EMAIL = 'SkedAI Reports <alerts@skedai.net>';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export type ReportFrequency = 'weekly' | 'monthly' | 'custom';

export interface ReportTenant {
  id:         string;
  name:       string;
  owner_email: string;
}

function formatReplyTime(seconds: number | null): string {
  if (seconds === null) return 'N/A';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatPeriodLabel(periodStart: string, periodEnd: string, frequency: ReportFrequency): string {
  const start = new Date(periodStart + 'T00:00:00Z');
  // periodEnd is the exclusive upper bound — display the last included day.
  const lastDay = new Date(new Date(periodEnd + 'T00:00:00Z').getTime() - 24 * 60 * 60 * 1000);

  if (frequency === 'monthly') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endLabel = lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${startLabel} – ${endLabel}`;
}

const FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'Email',
  messenger: 'Messenger',
};

function channelBreakdownLine(byChannel: Record<string, number>): string {
  const entries = Object.entries(byChannel);
  if (entries.length === 0) return 'No conversations this period';
  return entries
    .map(([ch, count]) => `${CHANNEL_LABELS[ch] || ch}: ${count}`)
    .join(' · ');
}

export async function sendOwnerReportEmail(
  tenant: ReportTenant,
  stats: OwnerReportStats,
  frequency: ReportFrequency,
): Promise<{ success: boolean; error?: string }> {
  if (!tenant.owner_email) return { success: false, error: 'No owner_email configured' };

  try {
    const frequencyLabel = FREQUENCY_LABELS[frequency];
    const periodLabel = formatPeriodLabel(stats.periodStart, stats.periodEnd, frequency);
    const subject = `Your ${frequencyLabel} SkedAI Report — ${tenant.name}`;

    const requestsLine = stats.requests
      ? `<p style="margin:0 0 10px;font-size:15px;color:#0f172a;">📋 <strong>${stats.requests.created}</strong> request${stats.requests.created !== 1 ? 's' : ''} created, <strong>${stats.requests.resolved}</strong> resolved</p>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:24px auto;background:white;border-radius:12px;
            overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#0D9488;padding:20px 24px;">
    <h2 style="color:white;margin:0;font-size:18px;font-weight:600;">
      📊 ${frequencyLabel} Report — ${tenant.name}
    </h2>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${periodLabel}</p>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 10px;font-size:15px;color:#0f172a;">💬 <strong>${stats.messagesAnswered}</strong> message${stats.messagesAnswered !== 1 ? 's' : ''} answered</p>
    <p style="margin:0 0 10px;font-size:15px;color:#0f172a;">⚡ Average reply time: <strong>${formatReplyTime(stats.avgReplySeconds)}</strong></p>
    <p style="margin:0 0 10px;font-size:15px;color:#0f172a;">🆕 <strong>${stats.newConversations}</strong> new conversation${stats.newConversations !== 1 ? 's' : ''}</p>
    <p style="margin:0 0 10px;font-size:15px;color:#0f172a;">📡 ${channelBreakdownLine(stats.conversationsByChannel)}</p>
    ${requestsLine}
    <div style="margin-top:20px;text-align:center;">
      <a href="https://app.skedai.net"
         style="display:inline-block;background:#0D9488;color:#fff;text-decoration:none;
                padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">
        View dashboard →
      </a>
    </div>
  </div>
  <div style="background:#f1f5f9;padding:12px 24px;border-top:1px solid #e2e8f0;">
    <p style="font-size:12px;color:#94a3b8;margin:0;text-align:center;">
      SkedAI · ${tenant.name} · support@skedai.net
    </p>
  </div>
</div>
</body>
</html>`;

    await getResend().emails.send({
      from:    FROM_EMAIL,
      to:      tenant.owner_email,
      subject,
      html,
    });

    console.log(`[OwnerReport] ✅ Sent ${frequency} report to ${tenant.owner_email} (tenant ${tenant.id})`);
    return { success: true };
  } catch (e: any) {
    console.error(`[OwnerReport] ❌ Failed to send report for tenant ${tenant.id}:`, e.message);
    return { success: false, error: e.message };
  }
}
