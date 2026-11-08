import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'

/** Круговая «Задачи по статусам» на панели — отдельным куском (08.11.2026):
 *  библиотеку графиков (~115 КБ сжатыми) рисует только руководство, а панель
 *  открывает каждая роль — СММ, производство, продажи. Раньше recharts
 *  импортировалась в саму панель и грузилась всем. */
export default function TasksByStatusPie({ data, colors, labelOf }: {
  data: Array<{ status: string; count: number | string }>
  colors: string[]
  labelOf: (status: string) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data.map(s => ({ ...s, count: Number(s.count) }))} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: any, n: any) => [v, labelOf(String(n))]} />
      </PieChart>
    </ResponsiveContainer>
  )
}
