import { MigrationInterface, QueryRunner } from 'typeorm';

/** Перевод существующих ФИО финансовой зарплатной ведомости на русский. */
export class RussifyFinanceEmployeeNames1784500000000 implements MigrationInterface {
  private readonly names: Array<[string, string]> = [
    ['Navruz Mardanov Shaymardanovich', 'Навруз Марданов Шаймарданович'],
    ['Lashkarova Savribegim Eradzhevna', 'Лашкарова Саврибегим Эраджевна'],
    ['Turazoda Muhammadamin Mahmad', 'Туразода Мухаммадамин Махмад'],
    ['Mayunusova Farzona Firdavsovna', 'Маюнусова Фарзона Фирдавсовна'],
    ['Oyembekova Amina Ruslanovna', 'Оембекова Амина Руслановна'],
    ['Rozikova Khusnidabonu', 'Розикова Хуснидабону'],
    ['Sabrina Oblokulova', 'Сабрина Облокулова'],
    ['Khakimova Maryam Khurshedovna', 'Хакимова Марьям Хуршедовна'],
    ['Rabiev Mahmud', 'Рабиев Махмуд'],
    ['Boboev Azam', 'Бобоев Азам'],
    ['Mehriniso Saidova Kosimovna', 'Мехринисо Саидова Косимовна'],
    ['Behruz Mirov', 'Бехруз Миров'],
    ['Zavkov Samad', 'Завков Самад'],
    ['Somoni Farzod', 'Сомони Фарзод'],
    ['Yatimov Sulaymon', 'Ятимов Сулаймон'],
    ['Boboev Muhamad', 'Бобоев Мухамад'],
    ['Pirov Jovidon', 'Пиров Джовидон'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_employees'))) return;
    for (const [latin, russian] of this.names) {
      await queryRunner.query(
        `UPDATE finance_employees SET name = $1 WHERE name = $2`,
        [russian, latin],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_employees'))) return;
    for (const [latin, russian] of this.names) {
      await queryRunner.query(
        `UPDATE finance_employees SET name = $1 WHERE name = $2`,
        [latin, russian],
      );
    }
  }
}
