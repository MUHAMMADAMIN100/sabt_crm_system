import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/services/api.service'
import { Send, Bot, User, Loader2, Sparkles, Trash2, Cpu } from 'lucide-react'
import clsx from 'clsx'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface AiModelOption {
  id: string
  name: string
  provider: 'gemini' | 'groq'
  description: string
  speed: 'fast' | 'medium' | 'slow'
}

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('ai-chat-history')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('ai-selected-model') || '')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load available models from backend
  const { data: modelsData } = useQuery<{ models: AiModelOption[]; defaultModel: string }>({
    queryKey: ['ai-models'],
    queryFn: () => aiApi.models(),
    staleTime: 5 * 60 * 1000,
  })

  // Set default model once loaded
  useEffect(() => {
    if (!selectedModel && modelsData?.defaultModel) {
      setSelectedModel(modelsData.defaultModel)
    }
  }, [modelsData, selectedModel])

  useEffect(() => {
    if (selectedModel) localStorage.setItem('ai-selected-model', selectedModel)
  }, [selectedModel])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    localStorage.setItem('ai-chat-history', JSON.stringify(messages.slice(-50)))
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const { reply } = await aiApi.chat(text, selectedModel || undefined)
      const assistantMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: reply, timestamp: new Date() }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e: any) {
      const errorMsg: Message = {
        id: `e-${Date.now()}`, role: 'assistant',
        content: `Ошибка: ${e?.response?.data?.message || e?.message || 'Не удалось получить ответ'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    setMessages([])
    localStorage.removeItem('ai-chat-history')
  }

  // Simple markdown rendering
  const renderContent = (content: string) => {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-surface-100 dark:bg-surface-700 px-1 py-0.5 rounded text-xs">$1</code>')
      .replace(/^### (.*$)/gm, '<h3 class="text-sm font-bold mt-3 mb-1">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 class="text-base font-bold mt-3 mb-1">$1</h2>')
      .replace(/^# (.*$)/gm, '<h1 class="text-lg font-bold mt-3 mb-1">$1</h1>')
      .replace(/^- (.*$)/gm, '<div class="flex gap-2 ml-2"><span class="text-primary-500 shrink-0">•</span><span>$1</span></div>')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">ИИ-помощник</h1>
            <p className="text-xs text-surface-500 dark:text-surface-400">Анализирует данные CRM в реальном времени</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {modelsData?.models && modelsData.models.length > 0 && (
            <div className="flex items-center gap-1.5 bg-surface-100 dark:bg-surface-800 rounded-xl px-2.5 py-1.5 border border-surface-200 dark:border-surface-700">
              <Cpu size={13} className="text-primary-500 shrink-0" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-xs font-medium text-surface-700 dark:text-surface-200 outline-none border-0 cursor-pointer pr-1"
                title="Выбрать модель ИИ"
              >
                {modelsData.models.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={clearChat} className="btn-ghost text-xs flex items-center gap-1.5 text-surface-400 hover:text-red-500">
              <Trash2 size={14} /> Очистить
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4" style={{ WebkitOverflowScrolling: 'touch' as any }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-800/30 flex items-center justify-center mb-4">
              <Bot size={32} className="text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2">Задайте вопрос</h2>
            <p className="text-sm text-surface-500 dark:text-surface-400 max-w-md mb-6">
              Я анализирую базу данных CRM и отвечаю на ваши вопросы о проектах, задачах, сотрудниках и эффективности.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
              {[
                'Какие задачи сейчас просрочены?',
                'Кто самый продуктивный сотрудник?',
                'Покажи статистику по проектам',
                'Какие задачи на проверке?',
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => { setInput(hint); inputRef.current?.focus() }}
                  className="text-left text-xs px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={16} className="text-white" />
              </div>
            )}
            <div className={clsx(
              'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              msg.role === 'user'
                ? 'bg-primary-600 text-white rounded-br-md'
                : 'bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 text-surface-800 dark:text-surface-200 rounded-bl-md shadow-sm'
            )}>
              {msg.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-surface-200 dark:bg-surface-700 flex items-center justify-center shrink-0 mt-0.5">
                <User size={16} className="text-surface-600 dark:text-surface-400" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className="bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                <Loader2 size={14} className="animate-spin" />
                Анализирую данные...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-surface-100 dark:border-surface-700 pt-3">
        <div className="flex items-end gap-2 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl px-4 py-2 shadow-sm focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задайте вопрос о проектах, задачах, сотрудниках..."
            rows={1}
            className="flex-1 bg-transparent text-sm outline-none resize-none text-surface-800 dark:text-surface-200 placeholder-surface-400 max-h-32"
            style={{ minHeight: '24px' }}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className={clsx(
              'p-2 rounded-xl transition-all shrink-0',
              input.trim() && !loading
                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                : 'text-surface-300 dark:text-surface-600 cursor-not-allowed'
            )}
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-surface-400 dark:text-surface-500 text-center mt-2">
          ИИ анализирует актуальные данные из базы CRM. Ответы могут быть неточными.
        </p>
      </div>
    </div>
  )
}
