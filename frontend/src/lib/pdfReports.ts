import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

// Setup vfs (fonts shipped with pdfmake — Roboto with full Cyrillic support)
;(pdfMake as any).vfs = (pdfFonts as any).vfs || (pdfFonts as any).pdfMake?.vfs

// Brand palette
const PRIMARY = '#6B4FCF'
const PRIMARY_DARK = '#4C2EAB'
const ACCENT = '#10B981'
const WARN = '#F59E0B'
const DANGER = '#EF4444'
const PINK = '#EC4899'
const INDIGO = '#6366F1'
const SURFACE = '#F8FAFC'
const TEXT = '#0F172A'
const MUTED = '#64748B'
const WHITE = '#FFFFFF'

const fmt = (n: number): string => Number(n || 0).toLocaleString('ru-RU')
const periodLabel = (p: 'week' | 'month'): string => p === 'week' ? 'Недельный отчёт' : 'Месячный отчёт'
const formatDate = (d: string | Date): string =>
  new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

// ─── Reusable layout pieces ─────────────────────────────────────────
function buildHeader(title: string, subtitle: string): any[] {
  const now = new Date().toLocaleString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  return [
    {
      table: {
        widths: ['*'],
        body: [[{
          text: '',
          fillColor: PRIMARY,
          border: [false, false, false, false],
          margin: [0, 0, 0, 0],
          fontSize: 0,
          // Empty thin top accent
          minHeight: 4,
        }]],
      },
      layout: 'noBorders',
      margin: [-40, -40, -40, 0],
    },
    {
      table: {
        widths: ['*', 'auto'],
        body: [[
          {
            stack: [
              { text: 'WeBrand', fontSize: 24, bold: true, color: WHITE, margin: [0, 0, 0, 4] },
              { text: title, fontSize: 16, bold: true, color: WHITE },
              { text: subtitle, fontSize: 9, color: '#DDD6FE', margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: now, fontSize: 9, color: WHITE, alignment: 'right' },
              { text: 'WeBrand', fontSize: 8, color: '#DDD6FE', alignment: 'right', margin: [0, 2, 0, 0] },
            ],
          },
        ]],
      },
      layout: {
        fillColor: () => PRIMARY_DARK,
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 14,
        paddingRight: () => 14,
        paddingTop: () => 12,
        paddingBottom: () => 12,
      },
      margin: [-40, 0, -40, 16],
    },
  ]
}

function buildKpiRow(items: Array<{ label: string; value: string; color: string }>): any {
  return {
    columns: items.map(it => ({
      stack: [
        {
          table: {
            widths: ['auto', '*'],
            body: [[
              { text: '', fillColor: it.color, border: [false, false, false, false] },
              {
                stack: [
                  { text: it.label, fontSize: 8, color: MUTED, margin: [0, 4, 0, 2] },
                  { text: it.value, fontSize: 14, bold: true, color: it.color },
                ],
                border: [false, false, false, false],
                fillColor: SURFACE,
                margin: [4, 0, 4, 4],
              },
            ]],
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
        },
      ],
      width: '*',
      margin: [0, 0, 4, 0],
    })),
    margin: [0, 0, 0, 12],
  }
}

function buildSectionTitle(text: string): any {
  return { text, fontSize: 11, bold: true, color: TEXT, margin: [0, 8, 0, 6] }
}

function buildTable(opts: {
  headers: string[]
  rows: any[][]
  headerColor?: string
  widths?: any[]
  alignments?: { [colIdx: number]: 'left' | 'center' | 'right' }
  cellColors?: { [colIdx: number]: string }
}): any {
  const { headers, rows, headerColor = PRIMARY, widths, alignments = {}, cellColors = {} } = opts
  return {
    table: {
      headerRows: 1,
      widths: widths || headers.map(() => '*'),
      body: [
        headers.map(h => ({
          text: h,
          bold: true,
          color: WHITE,
          fillColor: headerColor,
          fontSize: 9,
          alignment: 'center',
          margin: [0, 4, 0, 4],
        })),
        ...rows.map((row, ri) =>
          row.map((cell, ci) => ({
            text: String(cell ?? '—'),
            fontSize: 9,
            color: cellColors[ci] || TEXT,
            alignment: alignments[ci] || 'left',
            fillColor: ri % 2 === 1 ? SURFACE : undefined,
            margin: [3, 4, 3, 4],
          })),
        ),
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#E2E8F0',
      vLineColor: () => '#E2E8F0',
    },
    margin: [0, 0, 0, 10],
  }
}

function buildInfoCard(title: string, lines: string[]): any {
  return {
    stack: [
      { text: title, bold: true, fontSize: 10, color: TEXT, margin: [0, 0, 0, 4] },
      ...lines.map(line => ({ text: line, fontSize: 9, color: MUTED, margin: [0, 0, 0, 2] })),
    ],
    margin: [10, 8, 10, 8],
    fillColor: SURFACE,
    // pdfmake doesn't directly support stack fillColor, use a wrapper
  }
}

function commonFooter(currentPage: number, pageCount: number): any {
  return {
    margin: [40, 8, 40, 0],
    columns: [
      { text: 'WeBrand — отчёт сгенерирован автоматически', fontSize: 8, color: MUTED },
      { text: `Стр. ${currentPage} из ${pageCount}`, fontSize: 8, color: MUTED, alignment: 'right' },
    ],
  }
}

const baseStyles = {
  defaultFont: { font: 'Roboto' },
}

// ─── PROJECTS REPORT (aggregate) ────────────────────────────────────
export function generateProjectReport(data: any) {
  const period = data.period as 'week' | 'month'
  const subtitle = `${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: TEXT },
    content: [
      ...buildHeader('Отчёт по проектам', subtitle),
      buildKpiRow([
        { label: 'Проектов', value: String(data.totals.projectCount), color: PRIMARY },
        { label: 'Историй', value: fmt(data.totals.stories), color: PINK },
        { label: 'Задач создано', value: String(data.totals.tasksCreated), color: WARN },
        { label: 'Задач выполнено', value: String(data.totals.tasksDone), color: ACCENT },
      ]),
      buildSectionTitle('Проекты'),
      buildTable({
        headers: ['Проект', 'Тип', 'Менеджер', 'Истории', 'Создано', 'Выполнено', 'Прогресс'],
        rows: data.projects.map((p: any) => [
          p.name, p.type, p.managerName,
          p.period.stories, p.period.tasksCreated, p.period.tasksDone, `${p.progress}%`,
        ]),
        widths: ['*', 35, 75, 40, 45, 50, 50],
        alignments: { 1: 'center', 3: 'center', 4: 'center', 5: 'center', 6: 'center' },
        cellColors: { 3: PINK, 5: ACCENT },
      }),
    ],
    footer: commonFooter,
  }

  pdfMake.createPdf(docDefinition).open()
}

// ─── SINGLE PROJECT REPORT ─────────────────────────────────────────
export function generateSingleProjectReport(data: any) {
  const project = (data.projects || [])[0]
  if (!project) return

  const period = data.period as 'week' | 'month'
  const subtitle = `${project.name} · ${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`

  const content: any[] = [
    ...buildHeader('Отчёт по проекту', subtitle),
    buildKpiRow([
      { label: 'Историй за период', value: fmt(project.period.stories), color: PINK },
      { label: 'Задач в проекте', value: String(project.totals?.tasks ?? 0), color: WARN },
      { label: 'Выполнено', value: String(project.totals?.done ?? 0), color: ACCENT },
      { label: 'Прогресс', value: `${project.progress}%`, color: PRIMARY },
    ]),

    // Project info
    {
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: 'Информация о проекте', bold: true, fontSize: 10, color: TEXT, margin: [0, 0, 0, 6] },
            { text: `Тип: ${project.type}    Менеджер: ${project.managerName}    Участников: ${project.membersCount}`, fontSize: 9, color: MUTED, margin: [0, 0, 0, 3] },
            { text: `Старт: ${project.startDate || '—'}    Дедлайн: ${project.endDate}    Реклам: ${project.period.ads}`, fontSize: 9, color: MUTED },
          ],
          fillColor: SURFACE,
          margin: [10, 8, 10, 8],
          border: [false, false, false, false],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },
  ]

  if (project.description) {
    content.push(buildSectionTitle('Описание'))
    content.push({ text: project.description, fontSize: 9, color: MUTED, margin: [0, 0, 0, 10] })
  }

  if (project.tasksDoneInPeriodList?.length > 0) {
    content.push(buildSectionTitle(`Выполненные задачи за период (${project.tasksDoneInPeriodList.length})`))
    content.push(buildTable({
      headers: ['#', 'Задача', 'Исполнитель', 'Приоритет', 'Дата'],
      rows: project.tasksDoneInPeriodList.map((t: any, i: number) => [
        i + 1, t.title, t.assignee, t.priority, t.reviewedAt,
      ]),
      headerColor: ACCENT,
      widths: [25, '*', 80, 60, 60],
      alignments: { 0: 'center', 3: 'center', 4: 'center' },
      cellColors: { 4: MUTED },
    }))
  }

  if (project.tasksCreatedInPeriodList?.length > 0) {
    content.push(buildSectionTitle(`Созданные задачи за период (${project.tasksCreatedInPeriodList.length})`))
    content.push(buildTable({
      headers: ['#', 'Задача', 'Исполнитель', 'Статус', 'Приоритет'],
      rows: project.tasksCreatedInPeriodList.map((t: any, i: number) => [
        i + 1, t.title, t.assignee, t.status, t.priority,
      ]),
      headerColor: WARN,
      widths: [25, '*', 80, 60, 60],
      alignments: { 0: 'center', 3: 'center', 4: 'center' },
    }))
  }

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: TEXT },
    content,
    footer: commonFooter,
  }

  pdfMake.createPdf(docDefinition).open()
}

// ─── EMPLOYEES REPORT (aggregate) ──────────────────────────────────
export function generateEmployeeReport(data: any) {
  const period = data.period as 'week' | 'month'
  const subtitle = `${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`

  const content: any[] = [
    ...buildHeader('Отчёт по сотрудникам', subtitle),
    buildKpiRow([
      { label: 'Сотрудников', value: String(data.totals.employeeCount), color: PRIMARY },
      { label: 'Назначено задач', value: String(data.totals.tasksAssigned), color: WARN },
      { label: 'Выполнено', value: String(data.totals.tasksDone), color: ACCENT },
      { label: 'Часов', value: fmt(data.totals.hoursLogged), color: INDIGO },
    ]),
    buildSectionTitle('Производительность сотрудников'),
    buildTable({
      headers: ['Сотрудник', 'Должность', 'Назнач.', 'Вып.', 'Просроч.', 'Истор.', 'Часы', 'Эфф.'],
      rows: data.employees.map((e: any) => [
        e.name, e.position, e.tasksAssigned, e.tasksDone, e.tasksOverdue, e.stories, e.hoursLogged, `${e.efficiency}%`,
      ]),
      widths: ['*', 75, 40, 32, 45, 38, 32, 38],
      alignments: { 2: 'center', 3: 'center', 4: 'center', 5: 'center', 6: 'center', 7: 'center' },
      cellColors: { 3: ACCENT, 4: DANGER, 5: PINK, 7: PRIMARY },
    }),
  ]

  // Top performer detail (per employee with done tasks)
  const performers = data.employees.filter((e: any) => e.tasksDone > 0).slice(0, 10)
  if (performers.length > 0) {
    content.push({ text: '', pageBreak: 'before' })
    content.push(...buildHeader('Выполненные задачи', subtitle))
    performers.forEach((emp: any, idx: number) => {
      content.push({
        table: {
          widths: ['*', 'auto'],
          body: [[
            { stack: [
              { text: emp.name, bold: true, fontSize: 11, color: TEXT },
              { text: emp.position, fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
            ], fillColor: SURFACE, margin: [10, 6, 10, 6], border: [false, false, false, false] },
            { text: `${emp.tasksDone} вып. · ${emp.hoursLogged}ч`,
              fontSize: 11, bold: true, color: ACCENT, alignment: 'right',
              fillColor: SURFACE, margin: [10, 12, 10, 6], border: [false, false, false, false] },
          ]],
        },
        layout: 'noBorders',
        margin: [0, idx === 0 ? 0 : 8, 0, 4],
      })
      if (emp.doneTasksList?.length > 0) {
        content.push(buildTable({
          headers: ['#', 'Задача', 'Проект'],
          rows: emp.doneTasksList.map((t: any, i: number) => [i + 1, t.title, t.project]),
          widths: [25, '*', 120],
          alignments: { 0: 'center' },
          cellColors: { 0: MUTED, 2: PRIMARY },
        }))
      }
    })
  }

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: TEXT },
    content,
    footer: commonFooter,
  }

  pdfMake.createPdf(docDefinition).open()
}

// ─── SINGLE EMPLOYEE REPORT ────────────────────────────────────────
export function generateSingleEmployeeReport(data: any) {
  const emp = (data.employees || [])[0]
  if (!emp) return

  const period = data.period as 'week' | 'month'
  const subtitle = `${emp.name} · ${periodLabel(period)} · ${formatDate(data.from)} — ${formatDate(data.to)}`

  const content: any[] = [
    ...buildHeader('Отчёт по сотруднику', subtitle),
    buildKpiRow([
      { label: 'Назначено', value: String(emp.tasksAssigned), color: WARN },
      { label: 'Выполнено', value: String(emp.tasksDone), color: ACCENT },
      { label: 'Просрочено', value: String(emp.tasksOverdue), color: DANGER },
      { label: 'Эффективность', value: `${emp.efficiency}%`, color: PRIMARY },
    ]),
    buildKpiRow([
      { label: 'На проверке', value: String(emp.tasksReview), color: INDIGO },
      { label: 'Часов', value: fmt(emp.hoursLogged), color: INDIGO },
      { label: 'Историй', value: fmt(emp.stories), color: PINK },
    ]),

    // Profile
    {
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: 'Профиль', bold: true, fontSize: 10, color: TEXT, margin: [0, 0, 0, 6] },
            { text: `Должность: ${emp.position}    Отдел: ${emp.department || '—'}`, fontSize: 9, color: MUTED, margin: [0, 0, 0, 3] },
            { text: `Email: ${emp.email || '—'}    Телефон: ${emp.phone || '—'}`, fontSize: 9, color: MUTED, margin: [0, 0, 0, 3] },
            { text: `Принят: ${emp.hireDate || '—'}` + (emp.birthDate ? `    День рождения: ${emp.birthDate}` : ''), fontSize: 9, color: MUTED },
          ],
          fillColor: SURFACE,
          margin: [10, 8, 10, 8],
          border: [false, false, false, false],
        }]],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },
  ]

  if (emp.doneTasksList?.length > 0) {
    content.push(buildSectionTitle(`Выполненные задачи (${emp.doneTasksList.length})`))
    content.push(buildTable({
      headers: ['#', 'Задача', 'Проект'],
      rows: emp.doneTasksList.map((t: any, i: number) => [i + 1, t.title, t.project]),
      headerColor: ACCENT,
      widths: [25, '*', 120],
      alignments: { 0: 'center' },
      cellColors: { 0: MUTED, 2: PRIMARY },
    }))
  }

  if (emp.overdueTasksList?.length > 0) {
    content.push(buildSectionTitle(`Просроченные задачи (${emp.overdueTasksList.length})`))
    content.push(buildTable({
      headers: ['#', 'Задача', 'Проект', 'Дедлайн'],
      rows: emp.overdueTasksList.map((t: any, i: number) => [i + 1, t.title, t.project, t.deadline]),
      headerColor: DANGER,
      widths: [25, '*', 100, 60],
      alignments: { 0: 'center', 3: 'center' },
      cellColors: { 0: MUTED, 2: PRIMARY, 3: DANGER },
    }))
  }

  if (emp.allTasksInPeriod?.length > 0) {
    content.push(buildSectionTitle(`Все задачи за период (${emp.allTasksInPeriod.length})`))
    content.push(buildTable({
      headers: ['#', 'Задача', 'Проект', 'Статус', 'Дедлайн'],
      rows: emp.allTasksInPeriod.map((t: any, i: number) => [
        i + 1, t.title, t.project, t.status, t.deadline,
      ]),
      widths: [25, '*', 90, 50, 55],
      alignments: { 0: 'center', 3: 'center', 4: 'center' },
      cellColors: { 0: MUTED, 2: PRIMARY, 4: MUTED },
    }))
  }

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: TEXT },
    content,
    footer: commonFooter,
  }

  pdfMake.createPdf(docDefinition).open()
}

// Suppress unused style warning
void baseStyles
