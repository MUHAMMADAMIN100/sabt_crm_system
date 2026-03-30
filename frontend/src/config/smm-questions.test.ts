import { describe, it, expect } from 'vitest'
import SMM_QUESTIONS, { SmmQuestion } from './smm-questions'

describe('SMM_QUESTIONS config', () => {
  it('exports a non-empty array', () => {
    expect(SMM_QUESTIONS).toBeInstanceOf(Array)
    expect(SMM_QUESTIONS.length).toBeGreaterThan(0)
  })

  it('every question has required fields: key, label, type', () => {
    SMM_QUESTIONS.forEach((q: SmmQuestion) => {
      expect(q.key).toBeTruthy()
      expect(q.label).toBeTruthy()
      expect(['text', 'textarea', 'radio']).toContain(q.type)
    })
  })

  it('radio questions have options array', () => {
    const radioQuestions = SMM_QUESTIONS.filter(q => q.type === 'radio')
    expect(radioQuestions.length).toBeGreaterThan(0)
    radioQuestions.forEach(q => {
      expect(q.options).toBeInstanceOf(Array)
      expect(q.options!.length).toBeGreaterThan(0)
    })
  })

  it('all keys are unique', () => {
    const keys = SMM_QUESTIONS.map(q => q.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('contains expected core questions', () => {
    const keys = SMM_QUESTIONS.map(q => q.key)
    expect(keys).toContain('companyName')
    expect(keys).toContain('targetAudience')
    expect(keys).toContain('smmGoals')
  })
})
