import * as path from 'path'
import { DataSource, SelectQueryBuilder } from 'typeorm'
import { PROJECT_LIST_FIELDS } from './project-list-fields'

/** Списки задач, сторис и контент-плана видят все роли — деньги и бриф
 *  проекта в них попадать не должны (08.11.2026). Строим настоящие запросы
 *  сервисов без базы: getMany подменён, он только запоминает SQL. */
describe('списки отдают проект без денег', () => {
  const MONEY = ['budget', 'paidAmount', 'monthlyFee', 'totalContractValue', 'outstandingAmount',
    'marginEstimate', 'internalCostEstimate', 'tariffPriceSnapshot', 'brief', 'briefShareToken',
    'clientInfo', 'smmData', 'clientAccess']
  const original = (SelectQueryBuilder.prototype as any).getMany
  const captured: { name: string; sql: string }[] = []
  let current = ''

  beforeAll(async () => {
    const ds = new DataSource({ type: 'postgres', entities: [path.join(__dirname, '..', 'modules', '**', '*.entity.ts')] })
    await (ds as any).buildMetadatas()
    ;(SelectQueryBuilder.prototype as any).getMany = async function () {
      captured.push({ name: current, sql: this.getQuery() })
      return []
    }
    const make = (svcPath: string, svc: string, entPath: string, ent: string) => {
      const s = Object.create(require(svcPath)[svc].prototype)
      s.repo = ds.getRepository(require(entPath)[ent])
      return s
    }
    const tasks = make('../modules/tasks/tasks.service', 'TasksService', '../modules/tasks/task.entity', 'Task')
    const stories = make('../modules/stories/stories.service', 'StoriesService', '../modules/stories/story.entity', 'StoryLog')
    const plan = make('../modules/content-plan/content-plan.service', 'ContentPlanService', '../modules/content-plan/content-plan-item.entity', 'ContentPlanItem')
    const run = async (name: string, fn: () => Promise<unknown>) => { current = name; await fn() }
    await run('tasks.findAll', () => tasks.findAll({ viewerId: 'u', viewerRole: 'sales_manager_dev' }))
    await run('tasks.my', () => tasks.getMyTasks('u'))
    await run('tasks.fromManagement', () => tasks.getTasksFromManagement('u'))
    await run('tasks.assignedByMe', () => tasks.getTasksAssignedByMe('u'))
    await run('tasks.overdue', () => tasks.getOverdueTasks({ id: 'u', role: 'smm_specialist' }))
    await run('stories.all', () => stories.getAll('2026-11-01', '2026-11-30'))
    await run('stories.my', () => stories.getByEmployee('u', '2026-11-01', '2026-11-30'))
    await run('contentPlan.findAll', () => plan.findAll({ from: '2026-11-01' }))
    // Загрузка всех моделей через ts-jest в общем прогоне идёт дольше 5 с.
  }, 60_000)

  afterAll(() => { (SelectQueryBuilder.prototype as any).getMany = original })

  it('каждый список построен', () => {
    expect(captured.map(c => c.name)).toEqual([
      'tasks.findAll', 'tasks.my', 'tasks.fromManagement', 'tasks.assignedByMe', 'tasks.overdue',
      'stories.all', 'stories.my', 'contentPlan.findAll',
    ])
  })

  it('в каждом — имя и тип проекта, но не деньги и не бриф', () => {
    for (const { name, sql } of captured) {
      const select = sql.slice(0, sql.indexOf(' FROM '))
      const projectCols = [...select.matchAll(/"project"\."(\w+)"/g)].map(m => m[1]).sort()
      expect({ name, projectCols }).toEqual({ name, projectCols: [...PROJECT_LIST_FIELDS].sort() })
      for (const col of MONEY) expect(select).not.toContain(`"project"."${col}"`)
    }
  })
})
