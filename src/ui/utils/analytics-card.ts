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

function metricRow(
  label: string,
  accent: string,
  daily: number,
  weekly: number,
  monthly: number,
  y: number
): string {
  return `
    <rect x="86" y="${y - 38}" width="1068" height="62" rx="18" fill="rgba(255,255,255,0.022)"/>
    <circle cx="118" cy="${y - 6}" r="7" fill="${accent}"/>
    <text x="142" y="${y}" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" fill="#F3F6FC">${escapeXml(label)}</text>
    <text x="675" y="${y}" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#FFFFFF">${daily}</text>
    <text x="910" y="${y}" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#E5ECF7">${weekly}</text>
    <text x="1140" y="${y}" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#E5ECF7">${monthly}</text>
  `;
}

function rateTile(label: string, value: string, subtitle: string, x: number): string {
  return `
    <rect x="${x}" y="1236" width="318" height="176" rx="26" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.07)"/>
    <text x="${x + 34}" y="1292" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="20" font-weight="800" fill="#9DBBFF">${escapeXml(label)}</text>
    <text x="${x + 34}" y="1366" font-family="Georgia, 'Times New Roman', serif" font-size="60" font-weight="700" fill="#FFFFFF">${escapeXml(value)}</text>
    <text x="${x + 34}" y="1404" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="20" font-weight="600" fill="#A7B5CD">${escapeXml(subtitle)}</text>
  `;
}

function topCard(
  title: string,
  value: string,
  leftMeta: string,
  rightMeta: string,
  accent: string,
  x: number
): string {
  return `
    <rect x="${x}" y="278" width="334" height="210" rx="28" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.05)"/>
    <rect x="${x + 24}" y="308" width="78" height="8" rx="4" fill="${accent}" opacity="0.95"/>
    <text x="${x + 28}" y="352" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="22" font-weight="700" fill="#A2B0C7">${escapeXml(title)}</text>
    <text x="${x + 28}" y="438" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="700" fill="#FFFFFF">${escapeXml(value)}</text>
    <text x="${x + 28}" y="476" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="22" font-weight="700" fill="${accent}">${escapeXml(leftMeta)}</text>
    <text x="${x + 306}" y="476" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="22" font-weight="700" text-anchor="end" fill="#EDF2FA">${escapeXml(rightMeta)}</text>
  `;
}

export function renderAnalyticsCardSvg(data: PeriodicAnalytics): string {
  const generatedAt = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
  const deliveryRate = calculateRate(data.daily.delivered, data.daily.sent);
  const openRate = calculateRate(data.daily.opened, data.daily.delivered);
  const clickRate = calculateRate(data.daily.clicked, data.daily.opened);

  return `
  <svg width="1240" height="1500" viewBox="0 0 1240 1500" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="panel" x1="60" y1="40" x2="1180" y2="1460" gradientUnits="userSpaceOnUse">
        <stop stop-color="#09101B"/>
        <stop offset="0.56" stop-color="#0D1728"/>
        <stop offset="1" stop-color="#101827"/>
      </linearGradient>
      <radialGradient id="glowA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1080 180) rotate(130) scale(320 320)">
        <stop stop-color="#F59E0B" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#F59E0B" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(180 1280) rotate(25) scale(430 320)">
        <stop stop-color="#2563EB" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#2563EB" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="beam" x1="76" y1="0" x2="1164" y2="0" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FACC15"/>
        <stop offset="0.45" stop-color="#FB923C"/>
        <stop offset="1" stop-color="#38BDF8"/>
      </linearGradient>
      <filter id="shadow" x="0" y="0" width="1240" height="1500" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="30" stdDeviation="35" flood-color="#020617" flood-opacity="0.45"/>
      </filter>
    </defs>

    <rect width="1240" height="1500" fill="#040712"/>
    <rect x="40" y="38" width="1160" height="1420" rx="40" fill="url(#panel)" filter="url(#shadow)"/>
    <rect x="76" y="50" width="1088" height="18" rx="9" fill="url(#beam)"/>
    <circle cx="1080" cy="260" r="360" fill="url(#glowA)"/>
    <circle cx="170" cy="1300" r="420" fill="url(#glowB)"/>
    <path d="M960 1090L1180 850V1160C1128 1220 1066 1270 994 1312L960 1090Z" fill="rgba(59,130,246,0.04)"/>
    <path d="M1020 1360L1180 1220V1306C1134 1352 1078 1392 1012 1420L1020 1360Z" fill="rgba(236,72,153,0.05)"/>

    <text x="88" y="118" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="28" font-weight="700" fill="#FACC15">TermiSend</text>
    <text x="88" y="198" font-family="Georgia, 'Times New Roman', serif" font-size="62" font-weight="700" fill="#F8FAFC">Analytics Report Card</text>
    <text x="88" y="242" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="21" font-weight="600" fill="#A0AEC5">Generated ${escapeXml(generatedAt)}</text>
    <text x="1146" y="118" text-anchor="end" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="18" font-weight="800" fill="#8CA0C0">Shareable performance snapshot</text>

    ${topCard('Output', String(data.daily.sent), 'sent', `${data.daily.delivered} delivered`, '#4ADE80', 86)}
    ${topCard('Reach', escapeXml(deliveryRate), `${data.daily.opened} opens`, `${data.daily.clicked} clicks`, '#38BDF8', 453)}
    ${topCard('List Quality', String(data.daily.verified), 'verified', `${data.daily.invalid} invalid`, '#FB7185', 820)}

    <rect x="86" y="548" width="1068" height="646" rx="32" fill="rgba(6,12,22,0.72)" stroke="rgba(255,255,255,0.06)"/>
    <text x="120" y="614" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="20" font-weight="800" letter-spacing="2" fill="#8DA2C4">METRICS</text>
    <text x="120" y="666" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" fill="#C1CDE1">Metric</text>
    <text x="675" y="666" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#C1CDE1">24h</text>
    <text x="910" y="666" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#C1CDE1">7d</text>
    <text x="1140" y="666" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="26" font-weight="700" text-anchor="end" fill="#C1CDE1">30d</text>
    <line x1="120" y1="694" x2="1140" y2="694" stroke="#3A4A63" stroke-width="2"/>

    ${metricRow('Sent', '#4ADE80', data.daily.sent, data.weekly.sent, data.monthly.sent, 760)}
    ${metricRow('Delivered', '#86EFAC', data.daily.delivered, data.weekly.delivered, data.monthly.delivered, 824)}
    ${metricRow('Opened', '#38BDF8', data.daily.opened, data.weekly.opened, data.monthly.opened, 888)}
    ${metricRow('Clicked', '#60A5FA', data.daily.clicked, data.weekly.clicked, data.monthly.clicked, 952)}
    ${metricRow('Failed', '#F87171', data.daily.failed, data.weekly.failed, data.monthly.failed, 1016)}
    ${metricRow('Verified', '#7DD3FC', data.daily.verified, data.weekly.verified, data.monthly.verified, 1080)}
    ${metricRow('Invalid', '#FB7185', data.daily.invalid, data.weekly.invalid, data.monthly.invalid, 1144)}

    ${rateTile('Delivery Rate', deliveryRate, `${data.daily.delivered} of ${data.daily.sent} sent`, 86)}
    ${rateTile('Open Rate', openRate, `${data.daily.opened} opens from delivered`, 461)}
    ${rateTile('Click Rate', clickRate, `${data.daily.clicked} clicks from opens`, 836)}
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
          <text x="8" y="22" font-family="'Trebuchet MS', 'Segoe UI', sans-serif" font-size="14" fill="#FFFFFF">T</text>
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
