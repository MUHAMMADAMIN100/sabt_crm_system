import { generateTempPassword, TEMP_PASSWORD_ALPHABET } from './temp-password';

describe('generateTempPassword', () => {
  it('не короче 12 знаков даже при меньшем запросе', () => {
    expect(generateTempPassword()).toHaveLength(12);
    expect(generateTempPassword(6)).toHaveLength(12);
    expect(generateTempPassword(16)).toHaveLength(16);
  });

  it('только из читаемого алфавита', () => {
    const pwd = generateTempPassword(64);
    for (const ch of pwd) expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
  });

  it('каждый раз новый', () => {
    expect(generateTempPassword()).not.toEqual(generateTempPassword());
  });
});
