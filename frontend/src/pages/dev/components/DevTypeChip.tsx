// Чип типа проекта разработки: «Лендинг», «Телеграм бот», «CRM система»…
/** Чип типа проекта. Значение из базы как есть: внутри раздела общая
 *  подпись «Разработка» для 'Web сайт' ничего бы не сказала. */
export function DevTypeChip({ type }: { type?: string | null }) {
  if (!type) return null
  return (
    <span className="shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold bg-[#E7EEF9] text-[#244C8C] dark:bg-[#2D5DA8]/25 dark:text-[#A9C1EA]">
      {type}
    </span>
  )
}
