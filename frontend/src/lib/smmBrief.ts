import SMM_QUESTIONS from '@/config/smm-questions'

/**
 * Generate a beautifully-styled SMM brief document and open it in a new
 * window with the browser's print dialog auto-triggered. User can Save
 * as PDF (all browsers support this) or print directly.
 */
export function downloadSmmBrief(project: { name: string; smmData?: Record<string, any> | null }) {
  const smm = (project.smmData || {}) as Record<string, any>
  const dateStr = new Date().toLocaleDateString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const rows = SMM_QUESTIONS.map(q => {
    const raw = smm[q.key]
    const value = raw && String(raw).trim() ? String(raw) : '—'
    const isEmpty = value === '—'
    return `
      <tr>
        <td class="q">${escapeHtml(q.label)}</td>
        <td class="a ${isEmpty ? 'empty' : ''}">${escapeHtml(value).replace(/\n/g, '<br>')}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>SMM-анкета — ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    background: #f1f5f9;
    color: #1e293b;
    line-height: 1.55;
  }
  body { padding: 24px; }
  .doc {
    max-width: 820px;
    margin: 0 auto;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.08);
  }
  .hero {
    background: linear-gradient(135deg, #6B4FCF 0%, #7c3aed 60%, #4f46e5 100%);
    color: #fff;
    padding: 40px 48px 36px;
    position: relative;
  }
  .hero::after {
    content: '';
    position: absolute; right: -40px; top: -40px;
    width: 200px; height: 200px; border-radius: 50%;
    background: rgba(255,255,255,0.08);
  }
  .hero .logo {
    font-size: 28px; font-weight: 900;
    letter-spacing: -1px;
    display: inline-flex; align-items: flex-end; gap: 2px;
    margin-bottom: 20px;
    position: relative; z-index: 1;
  }
  .hero .logo-arrow { width: 14px; height: 16px; color: #fff; display: inline-block; margin-bottom: 2px; }
  .hero .logo-dot {
    width: 9px; height: 9px; border-radius: 50%; background: #ef4444;
    margin-bottom: 14px; margin-left: 2px; display: inline-block;
  }
  .hero h1 {
    font-size: 30px; font-weight: 800; letter-spacing: -0.5px;
    margin-bottom: 6px; position: relative; z-index: 1;
  }
  .hero .subtitle {
    font-size: 14px; color: rgba(255,255,255,0.78);
    position: relative; z-index: 1;
  }
  .meta {
    display: flex; flex-wrap: wrap; gap: 12px 32px;
    padding: 20px 48px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 13px;
  }
  .meta .item { display: inline-flex; align-items: center; gap: 8px; }
  .meta .label { color: #94a3b8; text-transform: uppercase; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
  .meta .value { color: #1e293b; font-weight: 600; }
  .content { padding: 32px 48px 48px; }
  .content h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
    color: #6B4FCF; font-weight: 700; margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  .content h2::before {
    content: ''; width: 4px; height: 16px; background: #6B4FCF; border-radius: 2px;
  }
  table {
    width: 100%; border-collapse: collapse;
    background: #f8fafc; border-radius: 10px; overflow: hidden;
  }
  td {
    padding: 14px 18px;
    vertical-align: top;
    font-size: 14px;
    border-bottom: 1px solid #e2e8f0;
  }
  tr:last-child td { border-bottom: 0; }
  td.q {
    width: 44%;
    color: #64748b;
    font-weight: 500;
    border-right: 1px solid #e2e8f0;
    background: #fff;
  }
  td.a { color: #1e293b; font-weight: 500; }
  td.a.empty { color: #cbd5e1; font-style: italic; }
  .footer {
    padding: 24px 48px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
  }
  .footer b { color: #6B4FCF; }
  @media print {
    body { background: #fff; padding: 0; }
    .doc { box-shadow: none; border-radius: 0; }
    .no-print { display: none !important; }
  }
  .print-btn {
    position: fixed; bottom: 24px; right: 24px;
    padding: 12px 22px; background: #6B4FCF; color: #fff;
    border: 0; border-radius: 10px; font-size: 14px; font-weight: 600;
    cursor: pointer; box-shadow: 0 4px 12px rgba(107,79,207,0.4);
    display: inline-flex; align-items: center; gap: 8px;
  }
  .print-btn:hover { background: #5a3fb5; }
</style>
</head>
<body>
  <div class="doc">
    <div class="hero">
      <div class="logo">
        sabt<svg class="logo-arrow" viewBox="0 0 12 14" fill="currentColor"><path d="M1 1L1 11L3.8 8.2L5.6 12.5L7 11.9L5.2 7.6L9 7.6L1 1Z"/></svg><span class="logo-dot"></span>
      </div>
      <h1>SMM-анкета проекта</h1>
      <div class="subtitle">${escapeHtml(project.name)}</div>
    </div>
    <div class="meta">
      <div class="item">
        <span class="label">Проект</span>
        <span class="value">${escapeHtml(project.name)}</span>
      </div>
      <div class="item">
        <span class="label">Дата</span>
        <span class="value">${dateStr}</span>
      </div>
      <div class="item">
        <span class="label">Вопросов</span>
        <span class="value">${SMM_QUESTIONS.length}</span>
      </div>
    </div>
    <div class="content">
      <h2>Ответы клиента</h2>
      <table>${rows}</table>
    </div>
    <div class="footer">
      Сгенерировано <b>Sabt CRM</b> · ${dateStr}
    </div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">
    📄 Сохранить как PDF
  </button>

  <script>
    // Auto-open print dialog after first render — user can save as PDF or cancel
    window.addEventListener('load', () => setTimeout(() => window.print(), 400));
  </script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.open()
  win.document.write(html)
  win.document.close()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
