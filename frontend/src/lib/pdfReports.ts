import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Brand colors
const PRIMARY: [number, number, number] = [107, 79, 207]      // #6B4FCF
const PRIMARY_DARK: [number, number, number] = [88, 28, 135]
const ACCENT: [number, number, number] = [16, 185, 129]
const WARN: [number, number, number] = [245, 158, 11]
const DANGER: [number, number, number] = [239, 68, 68]
const SURFACE: [number, number, number] = [248, 250, 252]
const SURFACE_DARK: [number, number, number] = [30, 41, 59]
const TEXT: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [100, 116, 139]

function setFill(doc: jsPDF, c: [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]) }
function setText(doc: jsPDF, c: [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]) }
function setDraw(doc: jsPDF, c: [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]) }

function fmt(n: number): string {
  return Number(n || 0).toLocaleString('ru-RU')
}

function periodLabel(period: 'week' | 'month'): string {
  return period === 'week' ? 'Недельный отчёт' : 'Месячный отчёт'
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

function drawHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageW = doc.internal.pageSize.getWidth()
  // Purple gradient header background (single color since jsPDF doesn't have gradient)
  setFill(doc, PRIMARY_DARK)
  doc.rect(0, 0, pageW, 38, 'F')
  setFill(doc, PRIMARY)
  doc.rect(0, 0, pageW, 4, 'F')

  // Logo/brand
  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('sabt', 14, 18)
  // Cursor accent
  setFill(doc, [255, 255, 255])
  doc.circle(34, 16, 1.5, 'F')

  // Title
  doc.setFontSize(16)
  doc.text(title, 14, 28)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  setText(doc, [220, 215, 255])
  doc.text(subtitle, 14, 34)

  // Date generated (top right)
  const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  doc.setFontSize(9)
  doc.text(now, pageW - 14, 12, { align: 'right' })
  doc.setFontSize(8)
  doc.text('Sabt CRM System', pageW - 14, 18, { align: 'right' })
}

function drawFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    setDraw(doc, [226, 232, 240])
    doc.setLineWidth(0.5)
    doc.line(14, pageH - 14, pageW - 14, pageH - 14)
    setText(doc, MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Sabt CRM — отчёт сгенерирован автоматически', 14, pageH - 8)
    doc.text(`Стр. ${i} из ${pageCount}`, pageW - 14, pageH - 8, { align: 'right' })
  }
}

function drawKpiRow(doc: jsPDF, y: number, items: Array<{ label: string; value: string; color: [number, number, number] }>) {
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14
  const gap = 4
  const cardW = (pageW - margin * 2 - gap * (items.length - 1)) / items.length
  const cardH = 22
  items.forEach((it, i) => {
    const x = margin + i * (cardW + gap)
    // Card bg
    setFill(doc, SURFACE)
    doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F')
    // Color accent left bar
    setFill(doc, it.color)
    doc.roundedRect(x, y, 2, cardH, 1, 1, 'F')
    // Label
    setText(doc, MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(it.label, x + 6, y + 7)
    // Value
    setText(doc, it.color)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(it.value, x + 6, y + 17)
  })
  return y + cardH + 6
}

// ─── PROJECTS REPORT ────────────────────────────────────────────────
export function generateProjectReport(data: any) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const period = data.period as 'week' | 'month'
  const subtitle = `${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`
  drawHeader(doc, 'Отчёт по проектам', subtitle)

  // KPI summary
  let y = 48
  y = drawKpiRow(doc, y, [
    { label: 'Проектов', value: String(data.totals.projectCount), color: PRIMARY },
    { label: 'Историй', value: fmt(data.totals.stories), color: [236, 72, 153] },
    { label: 'Задач создано', value: String(data.totals.tasksCreated), color: WARN },
    { label: 'Задач выполнено', value: String(data.totals.tasksDone), color: ACCENT },
  ])

  // Projects table
  setText(doc, TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Проекты', 14, y + 4)
  y += 8

  autoTable(doc, {
    startY: y,
    head: [['Проект', 'Тип', 'Менеджер', 'Истор.', 'Зад. созд.', 'Зад. вып.', 'Прогресс']],
    body: data.projects.map((p: any) => [
      p.name,
      p.type,
      p.managerName,
      String(p.period.stories),
      String(p.period.tasksCreated),
      String(p.period.tasksDone),
      `${p.progress}%`,
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center',
    },
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 32 },
      3: { cellWidth: 16, halign: 'center', textColor: [236, 72, 153], fontStyle: 'bold' },
      4: { cellWidth: 20, halign: 'center' },
      5: { cellWidth: 20, halign: 'center', textColor: ACCENT, fontStyle: 'bold' },
      6: { cellWidth: 22, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  })

  drawFooter(doc)

  const fileName = `Отчёт-проекты-${data.from}-${data.to}.pdf`
  doc.save(fileName)
}

// ─── EMPLOYEES REPORT ──────────────────────────────────────────────
export function generateEmployeeReport(data: any) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const period = data.period as 'week' | 'month'
  const subtitle = `${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`
  drawHeader(doc, 'Отчёт по сотрудникам', subtitle)

  let y = 48
  y = drawKpiRow(doc, y, [
    { label: 'Сотрудников', value: String(data.totals.employeeCount), color: PRIMARY },
    { label: 'Назначено задач', value: String(data.totals.tasksAssigned), color: WARN },
    { label: 'Выполнено', value: String(data.totals.tasksDone), color: ACCENT },
    { label: 'Часов', value: fmt(data.totals.hoursLogged), color: [99, 102, 241] },
  ])

  setText(doc, TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Производительность сотрудников', 14, y + 4)
  y += 8

  autoTable(doc, {
    startY: y,
    head: [['Сотрудник', 'Должность', 'Назнач.', 'Вып.', 'Просроч.', 'Истор.', 'Часы', 'Эфф.']],
    body: data.employees.map((e: any) => [
      e.name,
      e.position,
      String(e.tasksAssigned),
      String(e.tasksDone),
      String(e.tasksOverdue),
      String(e.stories),
      String(e.hoursLogged),
      `${e.efficiency}%`,
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center',
    },
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 32, fontSize: 8, textColor: MUTED },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 14, halign: 'center', textColor: ACCENT, fontStyle: 'bold' },
      4: { cellWidth: 18, halign: 'center', textColor: DANGER, fontStyle: 'bold' },
      5: { cellWidth: 16, halign: 'center', textColor: [236, 72, 153] },
      6: { cellWidth: 14, halign: 'center' },
      7: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (cellData) => {
      // Highlight efficiency column with color
      if (cellData.section === 'body' && cellData.column.index === 7) {
        const v = parseInt((cellData.cell.raw as string).replace('%', '')) || 0
        if (v >= 70) cellData.cell.styles.textColor = ACCENT
        else if (v >= 40) cellData.cell.styles.textColor = WARN
        else cellData.cell.styles.textColor = DANGER
      }
    },
    margin: { left: 14, right: 14 },
  })

  // Top performer detail page (per employee with done tasks)
  const performers = data.employees.filter((e: any) => e.tasksDone > 0).slice(0, 10)
  if (performers.length > 0) {
    doc.addPage()
    drawHeader(doc, 'Выполненные задачи', subtitle)
    let yy = 48
    performers.forEach((emp: any) => {
      if (yy > 250) { doc.addPage(); drawHeader(doc, 'Выполненные задачи (продолжение)', subtitle); yy = 48 }
      // Employee header
      setFill(doc, SURFACE)
      doc.roundedRect(14, yy, doc.internal.pageSize.getWidth() - 28, 14, 2, 2, 'F')
      setText(doc, TEXT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(emp.name, 18, yy + 6)
      setText(doc, MUTED)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(emp.position, 18, yy + 11)
      // Stats badge
      setText(doc, ACCENT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(`${emp.tasksDone} вып. · ${emp.hoursLogged}ч`, doc.internal.pageSize.getWidth() - 18, yy + 9, { align: 'right' })
      yy += 18

      if (emp.doneTasksList?.length > 0) {
        autoTable(doc, {
          startY: yy,
          head: [['#', 'Задача', 'Проект']],
          body: emp.doneTasksList.map((t: any, i: number) => [String(i + 1), t.title, t.project]),
          theme: 'plain',
          headStyles: { fillColor: [241, 245, 249], textColor: TEXT, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 8, halign: 'center', textColor: MUTED },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 50, textColor: PRIMARY, fontSize: 8 },
          },
          margin: { left: 14, right: 14 },
        })
        yy = (doc as any).lastAutoTable.finalY + 6
      } else {
        yy += 4
      }
    })
  }

  drawFooter(doc)
  const fileName = `Отчёт-сотрудники-${data.from}-${data.to}.pdf`
  doc.save(fileName)
}
