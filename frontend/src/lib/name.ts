/**
 * Abbreviate a full name: "Иванов Иван Иванович" → "Иванов И. И."
 * Keeps first token (usually surname) full, abbreviates the rest to initials.
 * Single-word names are returned as-is.
 */
export function shortenName(fullName?: string | null): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] || ''
  const [first, ...rest] = parts
  const initials = rest.map(w => `${w.charAt(0).toUpperCase()}.`).join(' ')
  return `${first} ${initials}`
}

/** Return "Вы" when the name belongs to the current user, otherwise shortened. */
export function displayName(fullName: string | undefined, isSelf: boolean): string {
  if (isSelf) return 'Вы'
  return shortenName(fullName)
}
