import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { filesApi, projectsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, ConfirmDialog } from '@/components/ui'
import { Upload, Trash2, Download, FileText, Image, Archive, File } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const getIcon = (mime: string) => {
  if (mime.startsWith('image/')) return Image
  if (mime.includes('pdf')) return FileText
  if (mime.includes('zip') || mime.includes('rar')) return Archive
  return File
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FilesPage() {
  const [projectId, setProjectId] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const qc = useQueryClient()
  const { t } = useTranslation()

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const { data: files, isLoading } = useQuery({
    queryKey: ['files-project', projectId],
    queryFn: () => projectId ? filesApi.byProject(projectId) : Promise.resolve([]),
    enabled: !!projectId,
  })

  const deleteMut = useMutation({
    mutationFn: filesApi.remove,
    onMutate: async (fileId: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey: ['files-project', projectId] })
      const previous = qc.getQueryData(['files-project', projectId])
      qc.setQueryData(['files-project', projectId], (old: any[]) => old?.filter((f: any) => f.id !== fileId) ?? [])
      return { previous }
    },
    onError: (_e: any, _v: any, context: any) => {
      qc.setQueryData(['files-project', projectId], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files-project', projectId] })
      toast.success(t('files.deleted'))
    },
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !projectId) return
    setUploading(true)
    try {
      await filesApi.upload(file, projectId)
      qc.invalidateQueries({ queryKey: ['files-project', projectId] })
      toast.success(t('files.uploaded'))
    } catch {
      toast.error(t('files.uploadError'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('files.title')}</h1>
        {projectId && (
          <label className={`btn-primary cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
            <Upload size={16} /> {uploading ? t('common.loading') : t('files.upload')}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>

      <div className="card">
        <label className="label">{t('tasks.project')}</label>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="input max-w-sm"
        >
          <option value="">{t('common.selectOption')}</option>
          {projects?.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {!projectId ? (
        <EmptyState title={t('tasks.project')} description={t('common.selectOption')} />
      ) : isLoading ? (
        <PageLoader />
      ) : !files?.length ? (
        <EmptyState
          title={t('files.noFiles')}
          action={
            <label className="btn-primary cursor-pointer">
              <Upload size={16} /> {t('files.upload')}
              <input type="file" className="hidden" onChange={handleUpload} />
            </label>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {files.map((f: any) => {
            const Icon = getIcon(f.mimetype)
            return (
              <div key={f.id} className="card flex items-center gap-3 group">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                  {f.mimetype.startsWith('image/') ? (
                    <img
                      src={`${import.meta.env.VITE_API_URL || ''}${f.path}`}
                      alt={f.originalName}
                      className="w-10 h-10 rounded-xl object-cover"
                      onError={(e: any) => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <Icon size={18} className="text-primary-600 dark:text-primary-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{f.originalName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-surface-400 dark:text-surface-500">{formatSize(f.size)}</span>
                    <span className="text-xs text-surface-300 dark:text-surface-600">•</span>
                    <span className="text-xs text-surface-400 dark:text-surface-500">{format(new Date(f.createdAt), 'dd.MM.yyyy')}</span>
                  </div>
                  {f.uploadedBy && (
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">↑ {f.uploadedBy.name}</p>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <a
                    href={`${import.meta.env.VITE_API_URL || ''}${f.path}`}
                    target="_blank"
                    rel="noreferrer"
                    download={f.originalName}
                    className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-400"
                  >
                    <Download size={14} />
                  </a>
                  <button
                    onClick={() => setDeleteId(f.id)}
                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId!)}
        title={t('common.delete') + '?'}
        message={t('tasks.deleteMessage')}
        danger
      />
    </div>
  )
}
