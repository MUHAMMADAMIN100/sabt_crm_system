// import { useState, useEffect } from 'react'
// import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
// import { timeTrackerApi, tasksApi } from '@/services/api.service'
// import { PageLoader } from '@/components/ui'
// import { Play, Square, Clock, Plus, Trash2 } from 'lucide-react'
// import { format } from 'date-fns'
// import toast from 'react-hot-toast'

// export default function TimeTrackerPage() {
//   const qc = useQueryClient()
//   const [elapsed, setElapsed] = useState(0)
//   const [selectedTask, setSelectedTask] = useState('')
//   const [logTask, setLogTask] = useState('')
//   const [logHours, setLogHours] = useState('')
//   const [logDesc, setLogDesc] = useState('')
//   const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])

//   const { data: running } = useQuery({ queryKey: ['running-timer'], queryFn: timeTrackerApi.running, refetchInterval: 5000 })
//   const { data: myLogs } = useQuery({ queryKey: ['my-time-logs'], queryFn: () => timeTrackerApi.my() })
//   const { data: myTasks } = useQuery({ queryKey: ['my-tasks'], queryFn: tasksApi.my })

//   useEffect(() => {
//     if (!running?.timerStartedAt) { setElapsed(0); return }
//     const interval = setInterval(() => {
//       setElapsed(Math.floor((Date.now() - new Date(running.timerStartedAt).getTime()) / 1000))
//     }, 1000)
//     return () => clearInterval(interval)
//   }, [running])

//   const startMut = useMutation({
//     mutationFn: () => timeTrackerApi.start(selectedTask),
//     onSuccess: () => { qc.invalidateQueries({ queryKey: ['running-timer'] }); toast.success('Таймер запущен') },
//   })

//   const stopMut = useMutation({
//     mutationFn: timeTrackerApi.stop,
//     onSuccess: () => { qc.invalidateQueries({ queryKey: ['running-timer'] }); qc.invalidateQueries({ queryKey: ['my-time-logs'] }); toast.success('Время сохранено') },
//   })

//   const logMut = useMutation({
//     mutationFn: () => timeTrackerApi.log({ taskId: logTask, timeSpent: parseFloat(logHours), date: logDate, description: logDesc }),
//     onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-time-logs'] }); setLogHours(''); setLogDesc(''); toast.success('Записано') },
//   })

//   const removeMut = useMutation({
//     mutationFn: timeTrackerApi.remove,
//     onSuccess: () => qc.invalidateQueries({ queryKey: ['my-time-logs'] }),
//   })

//   const formatElapsed = (secs: number) => {
//     const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
//     return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
//   }

//   const totalToday = myLogs?.filter((l: any) => l.date?.slice(0,10) === logDate).reduce((s: number, l: any) => s + parseFloat(l.timeSpent), 0) || 0

//   return (
//     <div className="space-y-6 max-w-3xl">
//       <h1 className="page-title">Тайм-трекер</h1>

//       {/* Timer */}
//       <div className="card text-center py-8">
//         <div className="text-5xl font-mono font-bold text-surface-900 mb-6">
//           {running ? formatElapsed(elapsed) : '00:00:00'}
//         </div>
//         {running ? (
//           <div className="space-y-3">
//             <p className="text-sm text-surface-500">Задача: <strong>{running.task?.title || '—'}</strong></p>
//             <button onClick={() => stopMut.mutate()} className="btn btn-danger mx-auto">
//               <Square size={16} /> Остановить
//             </button>
//           </div>
//         ) : (
//           <div className="flex items-center gap-3 justify-center">
//             <select value={selectedTask} onChange={e => setSelectedTask(e.target.value)} className="input w-64">
//               <option value="">— Выберите задачу —</option>
//               {myTasks?.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
//             </select>
//             <button onClick={() => selectedTask && startMut.mutate()} disabled={!selectedTask} className="btn-primary">
//               <Play size={16} /> Старт
//             </button>
//           </div>
//         )}
//       </div>

//       {/* Manual log */}
//       <div className="card">
//         <h3 className="section-title mb-4">Записать вручную</h3>
//         <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
//           <div className="col-span-2 md:col-span-1">
//             <label className="label">Задача</label>
//             <select value={logTask} onChange={e => setLogTask(e.target.value)} className="input">
//               <option value="">— Выбрать —</option>
//               {myTasks?.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
//             </select>
//           </div>
//           <div>
//             <label className="label">Часы</label>
//             <input type="number" step="0.25" value={logHours} onChange={e => setLogHours(e.target.value)} className="input" placeholder="0.0" />
//           </div>
//           <div>
//             <label className="label">Дата</label>
//             <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} className="input" />
//           </div>
//           <div className="col-span-2 md:col-span-1">
//             <label className="label">Описание</label>
//             <input value={logDesc} onChange={e => setLogDesc(e.target.value)} className="input" placeholder="Опционально" />
//           </div>
//         </div>
//         <button onClick={() => logTask && logHours && logMut.mutate()} disabled={!logTask || !logHours} className="btn-primary mt-3">
//           <Plus size={15} /> Записать
//         </button>
//       </div>

//       {/* Summary */}
//       <div className="card">
//         <div className="flex items-center justify-between mb-4">
//           <h3 className="section-title">История</h3>
//           <div className="flex items-center gap-2 text-sm">
//             <Clock size={14} className="text-primary-600" />
//             <span className="text-surface-500">Сегодня: <strong className="text-surface-900">{totalToday.toFixed(1)}ч</strong></span>
//           </div>
//         </div>
//         <div className="space-y-2">
//           {myLogs?.slice(0, 20).map((log: any) => (
//             <div key={log.id} className="flex items-center gap-3 p-3 bg-surface-50 rounded-xl">
//               <Clock size={14} className="text-primary-600 shrink-0" />
//               <div className="flex-1 min-w-0">
//                 <p className="text-sm font-medium truncate">{log.task?.title || '—'}</p>
//                 {log.description && <p className="text-xs text-surface-400">{log.description}</p>}
//               </div>
//               <span className="font-semibold text-sm text-primary-700 shrink-0">{parseFloat(log.timeSpent).toFixed(2)}ч</span>
//               <span className="text-xs text-surface-400 shrink-0">{log.date ? format(new Date(log.date), 'dd.MM') : ''}</span>
//               <button onClick={() => removeMut.mutate(log.id)} className="p-1 hover:bg-red-50 rounded-lg text-red-400 shrink-0">
//                 <Trash2 size={12} />
//               </button>
//             </div>
//           ))}
//           {!myLogs?.length && <p className="text-sm text-surface-400 text-center py-4">Нет записей</p>}
//         </div>
//       </div>
//     </div>
//   )
// }
