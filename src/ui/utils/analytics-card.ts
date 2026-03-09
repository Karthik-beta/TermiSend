import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { PeriodicAnalytics } from '../../types.js';

let warmupPromise: Promise<void> | null = null;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function calculateRate(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return '0%';
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function renderHeroStat(
  label: string,
  value: string,
  meta: string,
  accent: string,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="rgba(7,12,22,0.66)" stroke="rgba(255,255,255,0.1)"/>
    <rect x="${x + 22}" y="${y + 22}" width="88" height="10" rx="5" fill="${accent}"/>
    <text x="${x + 24}" y="${y + 64}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" letter-spacing="1.5" fill="#9FB1C8">${escapeXml(label)}</text>
    <text x="${x + 24}" y="${y + 150}" font-family="'Palatino Linotype', Georgia, serif" font-size="82" font-weight="700" fill="#FFFFFF">${escapeXml(value)}</text>
    <text x="${x + 24}" y="${y + height - 26}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="20" font-weight="700" fill="#D7E1EE">${escapeXml(meta)}</text>
  `;
}

function renderKpiCard(
  eyebrow: string,
  value: string,
  label: string,
  note: string,
  accent: string,
  x: number,
  y: number
): string {
  return `
    <rect x="${x}" y="${y}" width="244" height="182" rx="26" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.08)"/>
    <text x="${x + 22}" y="${y + 40}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="15" font-weight="700" letter-spacing="1.8" fill="#8EA4C4">${escapeXml(eyebrow)}</text>
    <text x="${x + 22}" y="${y + 110}" font-family="'Palatino Linotype', Georgia, serif" font-size="58" font-weight="700" fill="${accent}">${escapeXml(value)}</text>
    <text x="${x + 22}" y="${y + 138}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" fill="#F2F6FB">${escapeXml(label)}</text>
    <text x="${x + 22}" y="${y + 164}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="16" font-weight="600" fill="#93A7C5">${escapeXml(note)}</text>
  `;
}

function renderMetricRail(
  label: string,
  tone: string,
  daily: number,
  weekly: number,
  monthly: number,
  y: number
): string {
  const maxValue = Math.max(daily, weekly, monthly, 1);
  const dailyWidth = Math.max(32, Math.round((daily / maxValue) * 210));
  const weeklyWidth = Math.max(32, Math.round((weekly / maxValue) * 210));
  const monthlyWidth = Math.max(32, Math.round((monthly / maxValue) * 210));

  return `
    <text x="104" y="${y - 4}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="23" font-weight="700" fill="#F5F7FB">${escapeXml(label)}</text>
    <rect x="104" y="${y + 18}" width="210" height="12" rx="6" fill="rgba(255,255,255,0.07)"/>
    <rect x="104" y="${y + 18}" width="${dailyWidth}" height="12" rx="6" fill="${tone}"/>
    <rect x="444" y="${y + 18}" width="210" height="12" rx="6" fill="rgba(255,255,255,0.07)"/>
    <rect x="444" y="${y + 18}" width="${weeklyWidth}" height="12" rx="6" fill="${tone}" opacity="0.85"/>
    <rect x="784" y="${y + 18}" width="210" height="12" rx="6" fill="rgba(255,255,255,0.07)"/>
    <rect x="784" y="${y + 18}" width="${monthlyWidth}" height="12" rx="6" fill="${tone}" opacity="0.72"/>
    <text x="330" y="${y - 4}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="28" font-weight="700" text-anchor="end" fill="#FFFFFF">${daily}</text>
    <text x="670" y="${y - 4}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="28" font-weight="700" text-anchor="end" fill="#E6EEF9">${weekly}</text>
    <text x="1010" y="${y - 4}" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="28" font-weight="700" text-anchor="end" fill="#D7E4F3">${monthly}</text>
    <line x1="104" y1="${y + 48}" x2="1048" y2="${y + 48}" stroke="rgba(255,255,255,0.05)"/>
  `;
}

export function renderAnalyticsCardSvg(data: PeriodicAnalytics): string {
  const generatedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  const deliveryRate = calculateRate(data.daily.delivered, data.daily.sent);
  const safeCount = Math.max(data.daily.sent + data.daily.failed, data.daily.verified);
  const openRate = calculateRate(data.daily.totalOpens, data.daily.delivered);
  const clickRate = calculateRate(data.daily.totalClicks, data.daily.totalOpens);
  const weeklySafe = Math.max(data.weekly.sent + data.weekly.failed, data.weekly.verified);
  const monthlySafe = Math.max(data.monthly.sent + data.monthly.failed, data.monthly.verified);

  return `
  <svg width="1240" height="1600" viewBox="0 0 1240 1600" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="panel" x1="38" y1="34" x2="1204" y2="1554" gradientUnits="userSpaceOnUse">
        <stop stop-color="#050814"/>
        <stop offset="0.48" stop-color="#09111F"/>
        <stop offset="1" stop-color="#140F1F"/>
      </linearGradient>
      <linearGradient id="headline" x1="96" y1="0" x2="1144" y2="0" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FDE68A"/>
        <stop offset="0.3" stop-color="#FB7185"/>
        <stop offset="0.72" stop-color="#60A5FA"/>
        <stop offset="1" stop-color="#34D399"/>
      </linearGradient>
      <radialGradient id="sun" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1044 178) rotate(90) scale(280 280)">
        <stop stop-color="#FB923C" stop-opacity="0.24"/>
        <stop offset="0.6" stop-color="#FB923C" stop-opacity="0.1"/>
        <stop offset="1" stop-color="#FB923C" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="lagoon" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(228 1290) rotate(42) scale(420 340)">
        <stop stop-color="#38BDF8" stop-opacity="0.18"/>
        <stop offset="0.55" stop-color="#2563EB" stop-opacity="0.08"/>
        <stop offset="1" stop-color="#2563EB" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
        <path d="M34 0H0V34" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
      </pattern>
      <filter id="shadow" x="0" y="0" width="1240" height="1600" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="30" stdDeviation="35" flood-color="#020617" flood-opacity="0.45"/>
      </filter>
    </defs>

    <rect width="1240" height="1600" fill="#02040B"/>
    <rect x="40" y="38" width="1160" height="1520" rx="40" fill="url(#panel)" filter="url(#shadow)"/>
    <rect x="58" y="56" width="1124" height="1484" rx="30" fill="url(#grid)" opacity="0.24"/>
    <circle cx="1044" cy="178" r="300" fill="url(#sun)"/>
    <circle cx="228" cy="1290" r="410" fill="url(#lagoon)"/>
    <path d="M70 346C228 286 402 260 592 268C840 278 1032 350 1164 486" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>
    <path d="M870 1250C972 1186 1068 1082 1156 936" fill="none" stroke="rgba(251,113,133,0.14)" stroke-width="3"/>
    <rect x="96" y="88" width="1048" height="12" rx="6" fill="url(#headline)"/>

    <text x="96" y="144" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="28" font-weight="700" fill="#F8D56A">TermiSend</text>
    <text x="96" y="194" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#91A7C7">ANALYTICS CARD / TODAY IN IST</text>
    <text x="96" y="292" font-family="'Palatino Linotype', Georgia, serif" font-size="88" font-weight="700" fill="#F7F2EA">Campaign Pulse</text>
    <text x="96" y="340" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="23" font-weight="600" fill="#A9B7CC">Generated ${escapeXml(generatedAt)} IST with live SES and SQS activity.</text>
    <text x="1144" y="144" text-anchor="end" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="16" font-weight="700" letter-spacing="2" fill="#8EA4C4">SHAREABLE PERFORMANCE SNAPSHOT</text>

    ${renderHeroStat('Today Output', String(data.daily.sent), `${data.daily.delivered} delivered from ${data.daily.sent} sent`, '#34D399', 96, 404, 454, 214)}
    ${renderHeroStat('List Safety', String(safeCount), `${data.daily.invalid} invalid / ${data.daily.failed} failed`, '#FB7185', 592, 404, 552, 214)}

    ${renderKpiCard('Reach', deliveryRate, 'delivery rate', `${data.daily.delivered} reached inbox events`, '#7DD3FC', 96, 654)}
    ${renderKpiCard('Attention', openRate, 'open rate', `${data.daily.totalOpens} total opens`, '#60A5FA', 362, 654)}
    ${renderKpiCard('Action', clickRate, 'click rate', `${data.daily.totalClicks} total clicks`, '#F59E0B', 628, 654)}
    ${renderKpiCard('Signals', `${data.daily.hardBounced}/${data.daily.softBounced}`, 'hard / soft', `${data.daily.averageDeliveryTimeMs}ms avg delivery`, '#C084FC', 894, 654)}

    <rect x="86" y="878" width="1068" height="498" rx="34" fill="rgba(7,11,20,0.72)" stroke="rgba(255,255,255,0.08)"/>
    <text x="104" y="934" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="20" font-weight="700" letter-spacing="2.5" fill="#8EA4C4">PERIOD COMPARISON</text>
    <text x="104" y="976" font-family="'Palatino Linotype', Georgia, serif" font-size="48" font-weight="700" fill="#F7F2EA">Flow of the funnel</text>
    <text x="104" y="1012" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="20" font-weight="600" fill="#A6B6CB">Today uses calendar-day boundaries in IST. Weekly and monthly remain rolling windows.</text>

    <text x="330" y="1060" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" text-anchor="end" letter-spacing="1.8" fill="#7D93B2">TODAY</text>
    <text x="670" y="1060" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" text-anchor="end" letter-spacing="1.8" fill="#7D93B2">7 DAYS</text>
    <text x="1010" y="1060" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="18" font-weight="700" text-anchor="end" letter-spacing="1.8" fill="#7D93B2">30 DAYS</text>

    ${renderMetricRail('Sent', '#34D399', data.daily.sent, data.weekly.sent, data.monthly.sent, 1100)}
    ${renderMetricRail('Delivered', '#7DD3FC', data.daily.delivered, data.weekly.delivered, data.monthly.delivered, 1168)}
    ${renderMetricRail('Total Opens', '#60A5FA', data.daily.totalOpens, data.weekly.totalOpens, data.monthly.totalOpens, 1236)}
    ${renderMetricRail('Total Clicks', '#F59E0B', data.daily.totalClicks, data.weekly.totalClicks, data.monthly.totalClicks, 1304)}

    <rect x="86" y="1412" width="1068" height="112" rx="30" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.07)"/>
    <text x="116" y="1454" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="16" font-weight="700" letter-spacing="2.2" fill="#8EA4C4">QUALITY NOTES</text>
    <text x="116" y="1498" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="24" font-weight="700" fill="#F4F7FB">Safe ${safeCount} / Invalid ${data.daily.invalid} / Weekly Safe ${weeklySafe} / Monthly Safe ${monthlySafe}</text>
  </svg>
  `.trim();
}

export function warmAnalyticsCardRenderer(): Promise<void> {
  if (!warmupPromise) {
    const promise = sharp(
      Buffer.from(
        `
        <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" fill="#000000"/>
          <text x="8" y="22" font-family="'Gill Sans', 'Trebuchet MS', sans-serif" font-size="14" fill="#FFFFFF">T</text>
        </svg>
      `.trim()
      )
    )
      .jpeg({ quality: 70 })
      .toBuffer()
      .then(() => undefined)
      .catch(() => undefined);
    warmupPromise = promise;
  }

  return warmupPromise;
}

export async function generateAnalyticsCardJpeg(data: PeriodicAnalytics): Promise<string> {
  await warmAnalyticsCardRenderer();

  const svg = renderAnalyticsCardSvg(data);
  const outputPath = join(tmpdir(), `termisend-analytics-${randomUUID()}.jpg`);

  await sharp(Buffer.from(svg)).jpeg({ quality: 94, mozjpeg: true }).toFile(outputPath);

  return outputPath;
}
