import { devClientFromSmm } from './dev-client.logic';

// Анкета SMM-клиента у проектов разработки переезжает в контакты
// (решение владельца 14.10.2026): ничего из записанного не теряется.

describe('devClientFromSmm — анкета клиента dev-проекта в контакты', () => {
  it('владелец бизнеса становится контактным лицом, предпочтения — заметками', () => {
    expect(devClientFromSmm({ ownerName: ' Фарход ', preferences: 'Макеты — только через владельца' }, null))
      .toEqual({ contactPerson: 'Фарход', notes: 'Макеты — только через владельца' });
  });

  it('значимый день и начало сотрудничества дописываются в заметки датой по-русски', () => {
    expect(devClientFromSmm({ keyDate: '2026-03-08', keyDateNote: 'день рождения компании', collabSince: '2025-11-01' }, {}))
      .toEqual({ notes: 'Значимый день: 08.03.2026 — день рождения компании\nСотрудничаем с 01.11.2025' });
  });

  it('заполненные контакты не перезаписывает, остальные поля сохраняет', () => {
    const info = { companyName: 'ООО «Пример»', contactPerson: 'Мадина', notes: 'Своё', phone: '+992' };
    expect(devClientFromSmm({ ownerName: 'Фарход', preferences: 'Другое' }, info)).toBeNull();
    expect(devClientFromSmm({ preferences: 'Тон — деловой' }, { companyName: 'ООО «Пример»' }))
      .toEqual({ companyName: 'ООО «Пример»', notes: 'Тон — деловой' });
  });

  it('нечего переносить — null', () => {
    expect(devClientFromSmm(null, null)).toBeNull();
    expect(devClientFromSmm({ normReels: 4, ownerName: '  ' }, { phone: '+992' })).toBeNull();
  });
});
