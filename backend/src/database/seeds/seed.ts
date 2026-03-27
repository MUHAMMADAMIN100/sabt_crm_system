import 'reflect-metadata'
import { DataSource } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import * as dotenv from 'dotenv'
dotenv.config()

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://erp_user:erp_password@localhost:5432/erp_db',
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  synchronize: true,
})

async function seed() {
  await AppDataSource.initialize()
  console.log('🌱 Seeding database...')

  const userRepo = AppDataSource.getRepository('users')
  const empRepo = AppDataSource.getRepository('employees')
  const projectRepo = AppDataSource.getRepository('projects')
  const taskRepo = AppDataSource.getRepository('tasks')

  // ── Users ───────────────────────────────────────────────
  const existing = await userRepo.findOne({ where: { email: 'admin@erp.com' } })
  if (existing) {
    console.log('⚠️  Already seeded. Skipping.')
    await AppDataSource.destroy()
    return
  }

  const hashedAdmin = await bcrypt.hash('admin123', 12)
  const hashedPass = await bcrypt.hash('pass123', 12)

  const admin = userRepo.create({
    name: 'Администратор', email: 'admin@erp.com',
    password: hashedAdmin, role: 'admin', isActive: true,
  })

  const manager = userRepo.create({
    name: 'Алексей Смирнов', email: 'manager@erp.com',
    password: hashedPass, role: 'manager', isActive: true,
  })

  const emp1 = userRepo.create({
    name: 'Иван Петров', email: 'ivan@erp.com',
    password: hashedPass, role: 'employee', isActive: true,
  })

  const emp2 = userRepo.create({
    name: 'Мария Козлова', email: 'maria@erp.com',
    password: hashedPass, role: 'employee', isActive: true,
  })

  const emp3 = userRepo.create({
    name: 'Дмитрий Новиков', email: 'dmitry@erp.com',
    password: hashedPass, role: 'employee', isActive: true,
  })

  const [savedAdmin, savedManager, savedEmp1, savedEmp2, savedEmp3] =
    await userRepo.save([admin, manager, emp1, emp2, emp3])

  console.log('✅ Users created')

  // ── Employees ────────────────────────────────────────────
  await empRepo.save([
    empRepo.create({ fullName: 'Администратор', position: 'Системный администратор', department: 'IT', email: 'admin@erp.com', hireDate: '2020-01-01', status: 'active', userId: savedAdmin.id }),
    empRepo.create({ fullName: 'Алексей Смирнов', position: 'Менеджер проектов', department: 'Управление', email: 'manager@erp.com', phone: '+7 900 123-45-67', hireDate: '2021-03-15', status: 'active', userId: savedManager.id }),
    empRepo.create({ fullName: 'Иван Петров', position: 'Frontend разработчик', department: 'IT', email: 'ivan@erp.com', phone: '+7 900 234-56-78', hireDate: '2022-06-01', status: 'active', userId: savedEmp1.id }),
    empRepo.create({ fullName: 'Мария Козлова', position: 'Backend разработчик', department: 'IT', email: 'maria@erp.com', phone: '+7 900 345-67-89', hireDate: '2022-08-15', status: 'active', userId: savedEmp2.id }),
    empRepo.create({ fullName: 'Дмитрий Новиков', position: 'UI/UX Дизайнер', department: 'Дизайн', email: 'dmitry@erp.com', hireDate: '2023-01-10', status: 'active', userId: savedEmp3.id }),
  ])

  console.log('✅ Employees created')

  // ── Projects ─────────────────────────────────────────────
  const proj1 = projectRepo.create({
    name: 'Корпоративный портал', description: 'Разработка нового корпоративного портала с авторизацией и панелью управления',
    managerId: savedManager.id, status: 'in_progress', startDate: '2024-01-01', endDate: '2024-12-31',
    color: '#4f6ef7', progress: 65, members: [savedManager, savedEmp1, savedEmp2, savedEmp3],
  })

  const proj2 = projectRepo.create({
    name: 'Мобильное приложение', description: 'iOS и Android приложение для клиентов компании',
    managerId: savedManager.id, status: 'planning', startDate: '2024-06-01', endDate: '2025-03-31',
    color: '#22c55e', progress: 10, members: [savedManager, savedEmp1, savedEmp3],
  })

  const proj3 = projectRepo.create({
    name: 'Редизайн сайта', description: 'Полный редизайн корпоративного сайта',
    managerId: savedAdmin.id, status: 'completed', startDate: '2023-06-01', endDate: '2024-01-31',
    color: '#f59e0b', progress: 100, members: [savedAdmin, savedEmp2, savedEmp3],
  })

  const [savedProj1, savedProj2, savedProj3] = await projectRepo.save([proj1, proj2, proj3])
  console.log('✅ Projects created')

  // ── Tasks ────────────────────────────────────────────────
  const tasks = [
    taskRepo.create({ title: 'Настройка авторизации', description: 'JWT авторизация с refresh токенами', projectId: savedProj1.id, assigneeId: savedEmp2.id, createdById: savedManager.id, priority: 'high', status: 'done', deadline: new Date('2024-03-01'), estimatedHours: 8 }),
    taskRepo.create({ title: 'Разработка дашборда', description: 'Главная страница с графиками и статистикой', projectId: savedProj1.id, assigneeId: savedEmp1.id, createdById: savedManager.id, priority: 'high', status: 'in_progress', deadline: new Date('2024-08-01'), estimatedHours: 16 }),
    taskRepo.create({ title: 'Дизайн UI-компонентов', description: 'Создание библиотеки UI-компонентов', projectId: savedProj1.id, assigneeId: savedEmp3.id, createdById: savedManager.id, priority: 'medium', status: 'review', deadline: new Date('2024-07-15'), estimatedHours: 12 }),
    taskRepo.create({ title: 'API интеграция', description: 'Подключение фронтенда к backend API', projectId: savedProj1.id, assigneeId: savedEmp1.id, createdById: savedManager.id, priority: 'critical', status: 'in_progress', deadline: new Date('2024-09-01'), estimatedHours: 20 }),
    taskRepo.create({ title: 'Исследование рынка', description: 'Анализ конкурентов мобильных приложений', projectId: savedProj2.id, assigneeId: savedManager.id, createdById: savedAdmin.id, priority: 'medium', status: 'done', estimatedHours: 6 }),
    taskRepo.create({ title: 'Прототип экранов', description: 'Figma прототип основных экранов', projectId: savedProj2.id, assigneeId: savedEmp3.id, createdById: savedManager.id, priority: 'high', status: 'in_progress', deadline: new Date('2024-10-01'), estimatedHours: 24 }),
    taskRepo.create({ title: 'Анализ требований', description: 'Сбор и документирование требований', projectId: savedProj2.id, assigneeId: savedEmp2.id, createdById: savedManager.id, priority: 'medium', status: 'new', estimatedHours: 8 }),
    taskRepo.create({ title: 'Новый лендинг', description: 'Создание лендинга для корпоративного сайта', projectId: savedProj3.id, assigneeId: savedEmp1.id, createdById: savedAdmin.id, priority: 'high', status: 'done', estimatedHours: 10 }),
    taskRepo.create({ title: 'Оптимизация SEO', description: 'Улучшение позиций в поисковых системах', projectId: savedProj3.id, assigneeId: savedEmp3.id, createdById: savedAdmin.id, priority: 'low', status: 'done', estimatedHours: 6 }),
  ]

  await taskRepo.save(tasks)
  console.log('✅ Tasks created')

  console.log('\n🎉 Seed complete!')
  console.log('─────────────────────────────────')
  console.log('👤 Admin:   admin@erp.com   / admin123')
  console.log('👤 Manager: manager@erp.com / pass123')
  console.log('👤 Employee: ivan@erp.com   / pass123')
  console.log('─────────────────────────────────')

  await AppDataSource.destroy()
}

seed().catch(e => { console.error('❌ Seed error:', e); process.exit(1) })
